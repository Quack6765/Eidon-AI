import { z } from "zod";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { EXTERNAL_STT_LANGUAGE_CODES } from "@/lib/speech/external-providers";

export const INTEGRATION_CAPABILITIES = [
  "web_search",
  "image_generation",
  "speech_transcription"
] as const;

export type IntegrationCapability = typeof INTEGRATION_CAPABILITIES[number];
export type IntegrationScope = "global" | "user";
export type CredentialAction = "preserve" | "replace" | "clear";

export type IntegrationSelection<ProviderId extends string = string> = {
  providerId: ProviderId;
  configuration: Record<string, unknown>;
  configured: boolean;
  scope: IntegrationScope;
};

export type RuntimeIntegrationSelection<ProviderId extends string = string> =
  IntegrationSelection<ProviderId> & { credentials: { apiKey?: string } };

const credentialActionSchema = z.enum(["preserve", "replace", "clear"]);
const credentialFields = {
  credential: z.string().optional(),
  credentialAction: credentialActionSchema.default("preserve")
};

export const webSearchIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({ providerId: z.literal("disabled"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({ providerId: z.literal("exa"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({ providerId: z.literal("tavily"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({
    providerId: z.literal("searxng"),
    configuration: z.object({ baseUrl: z.string().url() }).strict(),
    ...credentialFields
  }).strict()
]);

export const imageGenerationIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({ providerId: z.literal("disabled"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({
    providerId: z.literal("google_nano_banana"),
    configuration: z.object({
      model: z.enum([
        "gemini-2.5-flash-image",
        "gemini-3.1-flash-image-preview",
        "gemini-3-pro-image-preview"
      ])
    }).strict(),
    ...credentialFields
  }).strict()
]);

export const speechTranscriptionIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({
    providerId: z.literal("browser"),
    configuration: z.object({ language: z.enum(["auto", "en", "fr", "es"]) }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("canary"),
    configuration: z.object({ language: z.enum(["en", "fr", "es"]) }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("elevenlabs"),
    configuration: z.object({ language: z.enum(EXTERNAL_STT_LANGUAGE_CODES) }).strict(),
    ...credentialFields
  }).strict()
]);

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

function getExactRow(capability: IntegrationCapability, userId: string | null) {
  const statement = userId
    ? "SELECT * FROM integration_settings WHERE capability = ? AND user_id = ?"
    : "SELECT * FROM integration_settings WHERE capability = ? AND user_id IS NULL";
  return getDb().prepare(statement).get(...(userId ? [capability, userId] : [capability])) as
    IntegrationRow | undefined;
}

function resolveRow(capability: IntegrationCapability, userId?: string) {
  return (userId ? getExactRow(capability, userId) : undefined) ??
    getExactRow(capability, null);
}

function rowToRuntimeSelection(row: IntegrationRow): RuntimeIntegrationSelection {
  const credentials = decryptCredentials(row.credentials_encrypted);
  const configuration = parseObject(row.configuration_json);
  const configured = row.provider_id === "disabled" || row.provider_id === "browser" ||
    row.provider_id === "canary" || row.provider_id === "exa" ||
    Boolean(credentials.apiKey) || Boolean(configuration.baseUrl);
  return {
    providerId: row.provider_id,
    configuration,
    configured,
    scope: row.user_id ? "user" : "global",
    credentials
  };
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
  const current = getRuntimeIntegrationSetting(parsed.capability, userId);
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
  const existing = getExactRow(parsed.capability, userId ?? null);
  if (existing) {
    const statement = userId
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
      ...(userId ? [userId] : [])
    );
  } else {
    getDb().prepare(`
      INSERT INTO integration_settings (
        capability, user_id, provider_id, configuration_json,
        credentials_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.capability,
      userId ?? null,
      parsed.providerId,
      JSON.stringify(parsed.configuration),
      encrypted,
      timestamp,
      timestamp
    );
  }
  return getIntegrationSetting(parsed.capability, userId);
}
