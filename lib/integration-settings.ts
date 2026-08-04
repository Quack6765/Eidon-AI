import { z } from "zod";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import {
  imageGenerationIntegrationUpdateSchema,
  isImageGenerationConfigured,
  normalizeImageGenerationSelection
} from "@/lib/image-generation/catalog";
import type {
  CredentialAction,
  IntegrationScope,
  IntegrationSelection,
  RuntimeIntegrationSelection
} from "@/lib/integration-types";
import {
  isTranscriptionConfigured,
  normalizeTranscriptionSelection,
  speechTranscriptionIntegrationUpdateSchema
} from "@/lib/speech/transcription-catalog";
import {
  isWebSearchConfigured,
  normalizeWebSearchSelection,
  webSearchIntegrationUpdateSchema
} from "@/lib/web-search-catalog";

export const INTEGRATION_CAPABILITY_CATALOG = {
  web_search: { scope: "user" },
  image_generation: { scope: "global" },
  speech_transcription: { scope: "user" }
} as const satisfies Record<string, { scope: IntegrationScope }>;

export const INTEGRATION_CAPABILITIES = Object.keys(
  INTEGRATION_CAPABILITY_CATALOG
) as Array<IntegrationCapability>;

export type IntegrationCapability = keyof typeof INTEGRATION_CAPABILITY_CATALOG;
export type { CredentialAction, IntegrationScope, IntegrationSelection, RuntimeIntegrationSelection };

const integrationUpdateSchemas = {
  web_search: webSearchIntegrationUpdateSchema,
  image_generation: imageGenerationIntegrationUpdateSchema,
  speech_transcription: speechTranscriptionIntegrationUpdateSchema
};

export const integrationSettingInputSchema = z.object({
  capability: z.enum(INTEGRATION_CAPABILITIES as [
    IntegrationCapability,
    ...IntegrationCapability[]
  ])
}).passthrough().transform((input, context) => {
  const { capability, ...setting } = input;
  const result = integrationUpdateSchemas[capability].safeParse(setting);
  if (!result.success) {
    for (const issue of result.error.issues) context.addIssue(issue);
    return z.NEVER;
  }
  return { capability, ...result.data };
});

type IntegrationRow = {
  capability: IntegrationCapability;
  user_id: string | null;
  provider_id: string;
  configuration_json: string;
  credentials_encrypted: string;
  created_at: string;
  updated_at: string;
};

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function decryptCredentials(value: string) {
  if (!value) return {};
  try {
    return parseObject(decryptValue(value)) as { apiKey?: string };
  } catch {
    return {};
  }
}

function getExactRow(capability: IntegrationCapability, userId: string | null) {
  const statement = userId
    ? "SELECT * FROM integration_settings WHERE capability = ? AND user_id = ?"
    : "SELECT * FROM integration_settings WHERE capability = ? AND user_id IS NULL";
  return getDb().prepare(statement).get(...(userId ? [capability, userId] : [capability])) as
    IntegrationRow | undefined;
}

function resolveRow(capability: IntegrationCapability, userId?: string) {
  const scopedUserId = INTEGRATION_CAPABILITY_CATALOG[capability].scope === "user"
    ? userId
    : undefined;
  return (scopedUserId ? getExactRow(capability, scopedUserId) : undefined) ??
    getExactRow(capability, null);
}

function rowToRuntimeSelection(row: IntegrationRow): RuntimeIntegrationSelection<string, Record<string, unknown>> {
  const decryptedCredentials = decryptCredentials(row.credentials_encrypted);
  const rawConfiguration = parseObject(row.configuration_json);
  const scope = row.user_id ? "user" as const : "global" as const;
  if (row.capability === "web_search") {
    const normalized = normalizeWebSearchSelection(row.provider_id, rawConfiguration);
    const credentials = normalized.providerId === row.provider_id ? decryptedCredentials : {};
    return { ...normalized, configured: isWebSearchConfigured({ ...normalized, credentials }), credentialStored: Boolean(credentials.apiKey), scope, credentials };
  }
  if (row.capability === "image_generation") {
    const normalized = normalizeImageGenerationSelection(row.provider_id, rawConfiguration);
    const credentials = normalized.providerId === row.provider_id ? decryptedCredentials : {};
    return { ...normalized, configured: isImageGenerationConfigured({ ...normalized, credentials }), credentialStored: Boolean(credentials.apiKey), scope, credentials };
  }
  const normalized = normalizeTranscriptionSelection(row.provider_id, rawConfiguration);
  const credentials = normalized.providerId === row.provider_id ? decryptedCredentials : {};
  return { ...normalized, configured: isTranscriptionConfigured({ ...normalized, credentials }), credentialStored: Boolean(credentials.apiKey), scope, credentials };
}

export function getRuntimeIntegrationSetting(
  capability: IntegrationCapability,
  userId?: string
) {
  const row = resolveRow(capability, userId);
  return row ? rowToRuntimeSelection(row) : null;
}

export function getIntegrationSetting(
  capability: IntegrationCapability,
  userId?: string
) {
  const runtime = getRuntimeIntegrationSetting(capability, userId);
  if (!runtime) return null;
  const { credentials: _credentials, ...selection } = runtime;
  return selection;
}

export function updateIntegrationSetting(input: unknown, userId?: string) {
  const parsed = integrationSettingInputSchema.parse(input);
  const scopedUserId = INTEGRATION_CAPABILITY_CATALOG[parsed.capability].scope === "user"
    ? userId
    : undefined;
  const current = getRuntimeIntegrationSetting(parsed.capability, scopedUserId);
  if (parsed.credentialAction === "replace" && !parsed.credential?.trim()) {
    throw new Error("A credential is required when replacing the stored credential");
  }
  const credentialAction = parsed.credentialAction === "preserve" &&
    current?.providerId !== parsed.providerId
    ? "clear"
    : parsed.credentialAction;
  const credentials = credentialAction === "preserve"
    ? current?.credentials ?? {}
    : credentialAction === "replace"
      ? { apiKey: parsed.credential!.trim() }
      : {};
  const encrypted = credentials.apiKey
    ? encryptValue(JSON.stringify(credentials))
    : "";
  const timestamp = new Date().toISOString();
  const existing = getExactRow(parsed.capability, scopedUserId ?? null);
  if (existing) {
    const statement = scopedUserId
      ? `UPDATE integration_settings SET provider_id = ?, configuration_json = ?,
          credentials_encrypted = ?, updated_at = ? WHERE capability = ? AND user_id = ?`
      : `UPDATE integration_settings SET provider_id = ?, configuration_json = ?,
          credentials_encrypted = ?, updated_at = ? WHERE capability = ? AND user_id IS NULL`;
    getDb().prepare(statement).run(
      parsed.providerId,
      JSON.stringify(parsed.configuration),
      encrypted,
      timestamp,
      parsed.capability,
      ...(scopedUserId ? [scopedUserId] : [])
    );
  } else {
    getDb().prepare(`
      INSERT INTO integration_settings (
        capability, user_id, provider_id, configuration_json,
        credentials_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.capability,
      scopedUserId ?? null,
      parsed.providerId,
      JSON.stringify(parsed.configuration),
      encrypted,
      timestamp,
      timestamp
    );
  }
  return getIntegrationSetting(parsed.capability, scopedUserId);
}

export {
  imageGenerationIntegrationUpdateSchema,
  speechTranscriptionIntegrationUpdateSchema,
  webSearchIntegrationUpdateSchema
};
