import { z } from "zod";

import {
  DEFAULT_PROVIDER_PROFILE_NAME,
  DEFAULT_PROVIDER_SETTINGS,
  SETTINGS_ROW_ID
} from "@/lib/constants";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import type {
  AppSettings,
  ProviderProfile,
  ProviderProfileWithApiKey,
  ReasoningEffort
} from "@/lib/types";

const runtimeSettingsSchema = z.object({
  apiBaseUrl: z.string().url(),
  apiKey: z.string().optional().default(""),
  model: z.string().min(1),
  apiMode: z.enum(["responses", "chat_completions"]),
  systemPrompt: z.string().min(1),
  temperature: z.coerce.number().min(0).max(2),
  maxOutputTokens: z.coerce.number().int().min(128).max(32768),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
  reasoningSummaryEnabled: z.coerce.boolean(),
  modelContextLimit: z.coerce.number().int().min(4096).max(2_000_000),
  compactionThreshold: z.coerce.number().min(0.5).max(0.95),
  freshTailCount: z.coerce.number().int().min(8).max(128)
});

const providerProfileInputSchema = runtimeSettingsSchema.extend({
  id: z.string().min(1),
  name: z.string().min(1)
});

const settingsSchema = z
  .object({
    defaultProviderProfileId: z.string().min(1),
    skillsEnabled: z.coerce.boolean(),
    providerProfiles: z.array(providerProfileInputSchema).min(1)
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();

    value.providerProfiles.forEach((profile, index) => {
      if (ids.has(profile.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provider profile ids must be unique",
          path: ["providerProfiles", index, "id"]
        });
      }

      ids.add(profile.id);
    });

    if (!ids.has(value.defaultProviderProfileId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Default provider profile must match a saved profile",
        path: ["defaultProviderProfileId"]
      });
    }
  });

type AppSettingsRow = {
  default_provider_profile_id: string;
  skills_enabled: number;
  updated_at: string;
};

type ProviderProfileRow = {
  id: string;
  name: string;
  api_base_url: string;
  api_key_encrypted: string;
  model: string;
  api_mode: "responses" | "chat_completions";
  system_prompt: string;
  temperature: number;
  max_output_tokens: number;
  reasoning_effort: ReasoningEffort;
  reasoning_summary_enabled: number;
  model_context_limit: number;
  compaction_threshold: number;
  fresh_tail_count: number;
  created_at: string;
  updated_at: string;
};

function rowToSettings(row: AppSettingsRow): AppSettings {
  return {
    defaultProviderProfileId: row.default_provider_profile_id,
    skillsEnabled: Boolean(row.skills_enabled),
    updatedAt: row.updated_at
  };
}

function rowToProviderProfile(row: ProviderProfileRow): ProviderProfile {
  return {
    id: row.id,
    name: row.name,
    apiBaseUrl: row.api_base_url,
    apiKeyEncrypted: row.api_key_encrypted,
    model: row.model,
    apiMode: row.api_mode,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    reasoningEffort: row.reasoning_effort,
    reasoningSummaryEnabled: Boolean(row.reasoning_summary_enabled),
    modelContextLimit: row.model_context_limit,
    compactionThreshold: row.compaction_threshold,
    freshTailCount: row.fresh_tail_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listProviderProfileRows() {
  return getDb()
    .prepare(
      `SELECT
        id,
        name,
        api_base_url,
        api_key_encrypted,
        model,
        api_mode,
        system_prompt,
        temperature,
        max_output_tokens,
        reasoning_effort,
        reasoning_summary_enabled,
        model_context_limit,
        compaction_threshold,
        fresh_tail_count,
        created_at,
        updated_at
      FROM provider_profiles
      ORDER BY created_at ASC`
    )
    .all() as ProviderProfileRow[];
}

function getProviderProfileRow(profileId: string) {
  return getDb()
    .prepare(
      `SELECT
        id,
        name,
        api_base_url,
        api_key_encrypted,
        model,
        api_mode,
        system_prompt,
        temperature,
        max_output_tokens,
        reasoning_effort,
        reasoning_summary_enabled,
        model_context_limit,
        compaction_threshold,
        fresh_tail_count,
        created_at,
        updated_at
      FROM provider_profiles
      WHERE id = ?`
    )
    .get(profileId) as ProviderProfileRow | undefined;
}

function withApiKey(profile: ProviderProfile): ProviderProfileWithApiKey {
  let apiKey = "";

  if (profile.apiKeyEncrypted) {
    try {
      apiKey = decryptValue(profile.apiKeyEncrypted);
    } catch {
      apiKey = "";
    }
  }

  return {
    ...profile,
    apiKey
  };
}

export function getSettings() {
  const row = getDb()
    .prepare(
      `SELECT
        default_provider_profile_id,
        skills_enabled,
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as AppSettingsRow;

  return rowToSettings(row);
}

export function listProviderProfiles() {
  return listProviderProfileRows().map(rowToProviderProfile);
}

export function listProviderProfilesWithApiKeys() {
  return listProviderProfiles().map(withApiKey);
}

export function getProviderProfile(profileId: string) {
  const row = getProviderProfileRow(profileId);
  return row ? rowToProviderProfile(row) : null;
}

export function getProviderProfileWithApiKey(profileId: string) {
  const profile = getProviderProfile(profileId);
  return profile ? withApiKey(profile) : null;
}

export function getDefaultProviderProfile() {
  const settings = getSettings();
  return getProviderProfile(settings.defaultProviderProfileId);
}

export function getDefaultProviderProfileWithApiKey() {
  const settings = getSettings();
  return getProviderProfileWithApiKey(settings.defaultProviderProfileId);
}

export function getSanitizedSettings() {
  const settings = getSettings();
  const providerProfiles = listProviderProfiles().map((profile) => {
    const { apiKeyEncrypted: _apiKeyEncrypted, ...sanitizedProfile } = profile;

    return {
      ...sanitizedProfile,
      hasApiKey: Boolean(profile.apiKeyEncrypted)
    };
  });

  return {
    ...settings,
    providerProfiles
  };
}

export function updateSettings(input: unknown) {
  const currentProfiles = new Map(
    listProviderProfilesWithApiKeys().map((profile) => [profile.id, profile])
  );
  const parsed = settingsSchema.parse(input);
  const timestamp = new Date().toISOString();
  const incomingIds = new Set(parsed.providerProfiles.map((profile) => profile.id));
  const removedProfileIds = [...currentProfiles.keys()].filter((id) => !incomingIds.has(id));

  const transaction = getDb().transaction(() => {
    const upsertProfile = getDb().prepare(
      `INSERT INTO provider_profiles (
        id,
        name,
        api_base_url,
        api_key_encrypted,
        model,
        api_mode,
        system_prompt,
        temperature,
        max_output_tokens,
        reasoning_effort,
        reasoning_summary_enabled,
        model_context_limit,
        compaction_threshold,
        fresh_tail_count,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @name,
        @apiBaseUrl,
        @apiKeyEncrypted,
        @model,
        @apiMode,
        @systemPrompt,
        @temperature,
        @maxOutputTokens,
        @reasoningEffort,
        @reasoningSummaryEnabled,
        @modelContextLimit,
        @compactionThreshold,
        @freshTailCount,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        api_base_url = excluded.api_base_url,
        api_key_encrypted = excluded.api_key_encrypted,
        model = excluded.model,
        api_mode = excluded.api_mode,
        system_prompt = excluded.system_prompt,
        temperature = excluded.temperature,
        max_output_tokens = excluded.max_output_tokens,
        reasoning_effort = excluded.reasoning_effort,
        reasoning_summary_enabled = excluded.reasoning_summary_enabled,
        model_context_limit = excluded.model_context_limit,
        compaction_threshold = excluded.compaction_threshold,
        fresh_tail_count = excluded.fresh_tail_count,
        updated_at = excluded.updated_at`
    );

    parsed.providerProfiles.forEach((profile) => {
      const current = currentProfiles.get(profile.id);
      const apiKey = profile.apiKey || current?.apiKey || "";

      upsertProfile.run({
        id: profile.id,
        name: profile.name,
        apiBaseUrl: profile.apiBaseUrl,
        apiKeyEncrypted: apiKey ? encryptValue(apiKey) : "",
        model: profile.model,
        apiMode: profile.apiMode,
        systemPrompt: profile.systemPrompt,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        reasoningEffort: profile.reasoningEffort,
        reasoningSummaryEnabled: profile.reasoningSummaryEnabled ? 1 : 0,
        modelContextLimit: profile.modelContextLimit,
        compactionThreshold: profile.compactionThreshold,
        freshTailCount: profile.freshTailCount,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp
      });
    });

    if (removedProfileIds.length) {
      const placeholders = removedProfileIds.map(() => "?").join(", ");

      getDb()
        .prepare(
          `UPDATE conversations
           SET provider_profile_id = ?
           WHERE provider_profile_id IN (${placeholders})`
        )
        .run(parsed.defaultProviderProfileId, ...removedProfileIds);

      getDb()
        .prepare(`DELETE FROM provider_profiles WHERE id IN (${placeholders})`)
        .run(...removedProfileIds);
    }

    getDb()
      .prepare(
        `UPDATE app_settings
         SET default_provider_profile_id = ?,
             skills_enabled = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        parsed.defaultProviderProfileId,
        parsed.skillsEnabled ? 1 : 0,
        timestamp,
        SETTINGS_ROW_ID
      );
  });

  transaction();

  return getSanitizedSettings();
}

export function getSettingsDefaults() {
  return {
    name: DEFAULT_PROVIDER_PROFILE_NAME,
    ...DEFAULT_PROVIDER_SETTINGS
  };
}
