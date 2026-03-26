import { z } from "zod";

import { DEFAULT_SETTINGS, SETTINGS_ROW_ID } from "@/lib/constants";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import type { AppSettings, ReasoningEffort } from "@/lib/types";

const settingsSchema = z.object({
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

type SettingsRow = {
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
  updated_at: string;
};

function rowToSettings(row: SettingsRow): AppSettings {
  return {
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
    updatedAt: row.updated_at
  };
}

export function getSettings() {
  const row = getDb()
    .prepare(
      `SELECT
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
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as SettingsRow;

  return rowToSettings(row);
}

export function getSettingsWithApiKey() {
  const settings = getSettings();

  return {
    ...settings,
    apiKey: settings.apiKeyEncrypted ? decryptValue(settings.apiKeyEncrypted) : ""
  };
}

export function getSanitizedSettings() {
  const settings = getSettings();

  return {
    ...settings,
    hasApiKey: Boolean(settings.apiKeyEncrypted)
  };
}

export function updateSettings(input: unknown) {
  const current = getSettingsWithApiKey();
  const parsed = settingsSchema.parse(input);
  const apiKey = parsed.apiKey || current.apiKey;
  const timestamp = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE app_settings
       SET api_base_url = @apiBaseUrl,
           api_key_encrypted = @apiKeyEncrypted,
           model = @model,
           api_mode = @apiMode,
           system_prompt = @systemPrompt,
           temperature = @temperature,
           max_output_tokens = @maxOutputTokens,
           reasoning_effort = @reasoningEffort,
           reasoning_summary_enabled = @reasoningSummaryEnabled,
           model_context_limit = @modelContextLimit,
           compaction_threshold = @compactionThreshold,
           fresh_tail_count = @freshTailCount,
           updated_at = @updatedAt
       WHERE id = ${SETTINGS_ROW_ID}`
    )
    .run({
      apiBaseUrl: parsed.apiBaseUrl,
      apiKeyEncrypted: apiKey ? encryptValue(apiKey) : "",
      model: parsed.model,
      apiMode: parsed.apiMode,
      systemPrompt: parsed.systemPrompt,
      temperature: parsed.temperature,
      maxOutputTokens: parsed.maxOutputTokens,
      reasoningEffort: parsed.reasoningEffort,
      reasoningSummaryEnabled: parsed.reasoningSummaryEnabled ? 1 : 0,
      modelContextLimit: parsed.modelContextLimit,
      compactionThreshold: parsed.compactionThreshold,
      freshTailCount: parsed.freshTailCount,
      updatedAt: timestamp
    });

  return getSanitizedSettings();
}

export function getSettingsDefaults() {
  return DEFAULT_SETTINGS;
}
