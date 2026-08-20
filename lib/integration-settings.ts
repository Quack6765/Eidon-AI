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

export const INTEGRATION_CAPABILITIES = [
  "web_search",
  "image_generation",
  "speech_transcription"
] as const;

export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];
export type { CredentialAction, IntegrationSelection, RuntimeIntegrationSelection };

const integrationUpdateSchemas = {
  web_search: webSearchIntegrationUpdateSchema,
  image_generation: imageGenerationIntegrationUpdateSchema,
  speech_transcription: speechTranscriptionIntegrationUpdateSchema
};

export const integrationSettingInputSchema = z.object({
  capability: z.enum(INTEGRATION_CAPABILITIES)
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

function getGlobalRow(capability: IntegrationCapability) {
  return getDb()
    .prepare("SELECT * FROM integration_settings WHERE capability = ? AND user_id IS NULL")
    .get(capability) as IntegrationRow | undefined;
}

function rowToRuntimeSelection(row: IntegrationRow): RuntimeIntegrationSelection<string, Record<string, unknown>> {
  const decryptedCredentials = decryptCredentials(row.credentials_encrypted);
  const rawConfiguration = parseObject(row.configuration_json);
  if (row.capability === "web_search") {
    const normalized = normalizeWebSearchSelection(row.provider_id, rawConfiguration);
    const credentials = normalized.providerId === row.provider_id ? decryptedCredentials : {};
    return { ...normalized, configured: isWebSearchConfigured({ ...normalized, credentials }), credentialStored: Boolean(credentials.apiKey), scope: "global" as const, credentials };
  }
  if (row.capability === "image_generation") {
    const normalized = normalizeImageGenerationSelection(row.provider_id, rawConfiguration);
    const credentials = normalized.providerId === row.provider_id ? decryptedCredentials : {};
    return { ...normalized, configured: isImageGenerationConfigured({ ...normalized, credentials }), credentialStored: Boolean(credentials.apiKey), scope: "global" as const, credentials };
  }
  const normalized = normalizeTranscriptionSelection(row.provider_id, rawConfiguration);
  const credentials = normalized.providerId === row.provider_id ? decryptedCredentials : {};
  return { ...normalized, configured: isTranscriptionConfigured({ ...normalized, credentials }), credentialStored: Boolean(credentials.apiKey), scope: "global" as const, credentials };
}

export function getRuntimeIntegrationSetting(capability: IntegrationCapability) {
  const row = getGlobalRow(capability);
  return row ? rowToRuntimeSelection(row) : null;
}

export function getIntegrationSetting(capability: IntegrationCapability) {
  const runtime = getRuntimeIntegrationSetting(capability);
  if (!runtime) return null;
  const { credentials: _credentials, ...selection } = runtime;
  return selection;
}

export function updateIntegrationSetting(input: unknown) {
  const parsed = integrationSettingInputSchema.parse(input);
  const current = getRuntimeIntegrationSetting(parsed.capability);
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
  const existing = getGlobalRow(parsed.capability);
  if (existing) {
    getDb().prepare(`
      UPDATE integration_settings SET provider_id = ?, configuration_json = ?,
        credentials_encrypted = ?, updated_at = ?
      WHERE capability = ? AND user_id IS NULL
    `).run(
      parsed.providerId,
      JSON.stringify(parsed.configuration),
      encrypted,
      timestamp,
      parsed.capability
    );
  } else {
    getDb().prepare(`
      INSERT INTO integration_settings (
        capability, user_id, provider_id, configuration_json,
        credentials_encrypted, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?)
    `).run(
      parsed.capability,
      parsed.providerId,
      JSON.stringify(parsed.configuration),
      encrypted,
      timestamp,
      timestamp
    );
  }
  return getIntegrationSetting(parsed.capability);
}

export {
  imageGenerationIntegrationUpdateSchema,
  speechTranscriptionIntegrationUpdateSchema,
  webSearchIntegrationUpdateSchema
};
