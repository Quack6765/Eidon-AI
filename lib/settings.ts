import { z } from "zod";

import {
  DEFAULT_PROVIDER_PROFILE_NAME,
  DEFAULT_PROVIDER_SETTINGS,
  MAX_ASSISTANT_CONTROL_STEPS,
  SETTINGS_ROW_ID
} from "@/lib/constants";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import {
  DEFAULT_EXTERNAL_STT_LANGUAGE,
  DEFAULT_EXTERNAL_STT_PROVIDER,
  EXTERNAL_STT_LANGUAGE_CODES,
  EXTERNAL_STT_PROVIDER_IDS,
  getExternalSttProviderConfig,
  isExternalSttLanguageForProvider
} from "@/lib/speech/external-providers";
import type {
  AppSettings,
  GithubConnectionStatus,
  ImageGenerationBackend,
  ProviderProfile,
  ProviderProfileWithApiKey,
  ReasoningEffort,
  VisionMode
} from "@/lib/types";

const runtimeSettingsSchema = z.object({
  providerKind: z.enum(["openai_compatible", "github_copilot", "anthropic"]).default("openai_compatible"),
  apiBaseUrl: z.string().default(""),
  apiKey: z.string().optional().default(""),
  apiKeyAction: z.enum(["preserve", "replace", "clear"]).optional(),
  model: z.string().min(0),
  apiMode: z.enum(["responses", "chat_completions"]),
  systemPrompt: z.string().min(0),
  temperature: z.coerce.number().min(0).max(2),
  maxOutputTokens: z.coerce.number().int().min(128),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]),
  reasoningSummaryEnabled: z.coerce.boolean(),
  modelContextLimit: z.coerce.number().int().min(4096).max(2_000_000),
  compactionThreshold: z.coerce.number().min(0.5).max(0.95),
  freshTailCount: z.coerce.number().int().min(8).max(128),
  tokenizerModel: z.enum(["gpt-tokenizer", "off"]).default("gpt-tokenizer"),
  safetyMarginTokens: z.coerce.number().int().min(128).max(32768).default(1200),
  leafSourceTokenLimit: z.coerce.number().int().min(1000).max(100000).default(12000),
  leafMinMessageCount: z.coerce.number().int().min(2).max(50).default(6),
  mergedMinNodeCount: z.coerce.number().int().min(2).max(20).default(4),
  mergedTargetTokens: z.coerce.number().int().min(128).max(16000).default(1600),
  visionMode: z.enum(["none", "native", "mcp"]).default("native"),
  providerPresetId: z.enum(["ollama_cloud", "glm_coding_plan", "openrouter", "opencode_go", "deepseek", "xiaomi_mimo", "custom_openai_compatible", "anthropic_official", "opencode_go_anthropic"]).nullable().default(null),
  githubUserAccessTokenEncrypted: z.string().default(""),
  githubRefreshTokenEncrypted: z.string().default(""),
  githubAccountLogin: z.string().nullable().default(null),
  githubAccountName: z.string().nullable().default(null),
  githubTokenExpiresAt: z.string().nullable().default(null),
  githubRefreshTokenExpiresAt: z.string().nullable().default(null)
});

const providerProfileInputSchema = runtimeSettingsSchema.extend({
  id: z.string().min(1),
  name: z.string().min(1)
}).superRefine((value, context) => {
  if (value.providerKind !== "github_copilot") {
    if (!value.apiBaseUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "API base URL is required for OpenAI-compatible profiles",
        path: ["apiBaseUrl"]
      });
    }
    if (!value.model) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Model is required for OpenAI-compatible profiles",
        path: ["model"]
      });
    }
    if (!value.systemPrompt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "System prompt is required for OpenAI-compatible profiles",
        path: ["systemPrompt"]
      });
    }
  }

  if (value.maxOutputTokens + value.safetyMarginTokens >= value.modelContextLimit) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `maxOutputTokens (${value.maxOutputTokens}) plus safetyMarginTokens (${value.safetyMarginTokens}) must be less than modelContextLimit (${value.modelContextLimit})`,
      path: ["maxOutputTokens"]
    });
  }
});

const settingsSchema = z
  .object({
    defaultProviderProfileId: z.string().min(1),
    skillsEnabled: z.coerce.boolean(),
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]).default("forever"),
    memoriesEnabled: z.coerce.boolean().default(true),
    memoriesMaxCount: z.coerce.number().int().min(1).max(500).default(100),
    mcpTimeout: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
    providerProfiles: z.array(providerProfileInputSchema).min(1)
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const names = new Set<string>();

    value.providerProfiles.forEach((profile, index) => {
      if (ids.has(profile.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provider profile ids must be unique",
          path: ["providerProfiles", index, "id"]
        });
      }

      ids.add(profile.id);

      const normalizedName = profile.name.trim().toLowerCase();
      if (names.has(normalizedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provider profile names must be unique",
          path: ["providerProfiles", index, "name"]
        });
      }

      names.add(normalizedName);
    });

    if (!ids.has(value.defaultProviderProfileId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Default provider profile must match a saved profile",
        path: ["defaultProviderProfileId"]
      });
    }
  });

const generalSettingsInputSchema = z.object({
  conversationRetention: z.enum(["forever", "90d", "30d", "7d"]).optional(),
  memoriesEnabled: z.coerce.boolean().optional(),
  memoriesMaxCount: z.coerce.number().int().min(1).max(500).optional(),
  mcpTimeout: z.coerce.number().int().min(10_000).max(600_000).optional(),
  maxAssistantToolSteps: z.coerce.number().int().min(1).max(1000).optional(),
  sttEngine: z.enum(["browser", "embedded", "external"]).optional(),
  sttProvider: z.enum(EXTERNAL_STT_PROVIDER_IDS).optional(),
  sttLanguage: z.enum(["auto", "en", "fr", "es"]).optional(),
  externalSttLanguage: z.enum(EXTERNAL_STT_LANGUAGE_CODES).optional(),
  externalSttApiKey: z.string().optional(),
  externalSttApiKeyAction: z.enum(["preserve", "replace", "clear"]).optional(),
  webSearchEngine: z.enum(["exa", "tavily", "searxng", "disabled"]).optional(),
  exaApiKey: z.string().optional(),
  tavilyApiKey: z.string().optional(),
  searxngBaseUrl: z.string().optional(),
  clearExaApiKey: z.coerce.boolean().optional(),
  clearTavilyApiKey: z.coerce.boolean().optional()
}).superRefine((value, context) => {
  if (value.externalSttApiKeyAction === "replace" && !value.externalSttApiKey?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An external speech-to-text API key is required when replacing the stored key",
      path: ["externalSttApiKey"]
    });
  }
});

const imageGenerationSettingsInputSchema = z.object({
  imageGenerationBackend: z.enum(["disabled", "google_nano_banana"]),
  googleNanoBananaModel: z
    .enum(["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"])
    .default("gemini-3.1-flash-image-preview"),
  googleNanoBananaApiKey: z.string().optional(),
  googleNanoBananaApiKeyAction: z.enum(["preserve", "replace", "clear"]).optional()
}).superRefine((value, context) => {
  if (value.googleNanoBananaApiKeyAction === "replace" && !value.googleNanoBananaApiKey?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A Google image API key is required when replacing the stored key",
      path: ["googleNanoBananaApiKey"]
    });
  }
});

const titleGenerationSettingsInputSchema = z.object({
  titleGenerationMode: z.enum(["same", "specific", "local"]),
  titleGenerationProfileId: z.string().nullable().optional()
});

const generalSettingsBundleInputSchema = z.object({
  general: generalSettingsInputSchema,
  imageGeneration: imageGenerationSettingsInputSchema.optional(),
  titleGeneration: titleGenerationSettingsInputSchema.optional()
});

const generalSettingsSchema = z
  .object({
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]),
    memoriesEnabled: z.coerce.boolean(),
    memoriesMaxCount: z.coerce.number().int().min(1).max(500),
    mcpTimeout: z.coerce.number().int().min(10_000).max(600_000),
    maxAssistantToolSteps: z.coerce.number().int().min(1).max(1000),
    sttEngine: z.enum(["browser", "embedded", "external"]),
    sttProvider: z.enum(EXTERNAL_STT_PROVIDER_IDS),
    sttLanguage: z.enum(["auto", "en", "fr", "es"]),
    externalSttLanguage: z.enum(EXTERNAL_STT_LANGUAGE_CODES),
    externalSttApiKey: z.string(),
    webSearchEngine: z.enum(["exa", "tavily", "searxng", "disabled"]),
    exaApiKey: z.string(),
    tavilyApiKey: z.string(),
    searxngBaseUrl: z.string()
  })
  .superRefine((value, context) => {
    if (!isExternalSttLanguageForProvider(value.sttProvider, value.externalSttLanguage)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["externalSttLanguage"],
        message: "Language is unavailable for the selected speech-to-text provider"
      });
    }

    if (value.sttEngine === "external" && !value.externalSttApiKey.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["externalSttApiKey"],
        message: "External speech-to-text API key is required"
      });
    }

    if (value.webSearchEngine === "tavily" && !value.tavilyApiKey.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tavilyApiKey"],
        message: "Tavily API key is required"
      });
    }

    if (value.webSearchEngine === "searxng") {
      const baseUrl = value.searxngBaseUrl.trim();

      if (!baseUrl) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["searxngBaseUrl"],
          message: "SearXNG URL is required"
        });
        return;
      }

      try {
        new URL(baseUrl);
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["searxngBaseUrl"],
          message: "SearXNG URL must be valid"
        });
      }
    }
  });

type AppSettingsRow = {
  default_provider_profile_id: string | null;
  skills_enabled: number;
  conversation_retention: string;
  auto_compaction: number;
  memories_enabled: number;
  memories_max_count: number;
  mcp_timeout: number;
  max_assistant_tool_steps?: number;
  stt_engine?: string;
  stt_provider?: string;
  stt_language?: string;
  external_stt_language?: string;
  external_stt_api_key_encrypted?: string;
  web_search_engine?: string;
  exa_api_key_encrypted?: string;
  tavily_api_key_encrypted?: string;
  searxng_base_url?: string;
  image_generation_backend?: string;
  google_nano_banana_model?: string;
  google_nano_banana_api_key_encrypted?: string;
  comfyui_base_url?: string;
  comfyui_auth_type?: string;
  comfyui_bearer_token_encrypted?: string;
  comfyui_workflow_json?: string;
  comfyui_prompt_path?: string;
  comfyui_negative_prompt_path?: string;
  comfyui_width_path?: string;
  comfyui_height_path?: string;
  comfyui_seed_path?: string;
  title_generation_mode?: string;
  title_generation_profile_id?: string | null;
  updated_at: string;
};

type UserSettingsRow = {
  user_id: string;
  default_provider_profile_id: string | null;
  skills_enabled: number;
  conversation_retention: string;
  auto_compaction: number;
  memories_enabled: number;
  memories_max_count: number;
  mcp_timeout: number;
  max_assistant_tool_steps?: number;
  stt_engine: string;
  stt_provider: string;
  stt_language: string;
  external_stt_language: string;
  external_stt_api_key_encrypted: string;
  web_search_engine: string;
  exa_api_key_encrypted: string;
  tavily_api_key_encrypted: string;
  searxng_base_url: string;
  image_generation_backend?: string;
  google_nano_banana_model?: string;
  google_nano_banana_api_key_encrypted?: string;
  comfyui_base_url?: string;
  comfyui_auth_type?: string;
  comfyui_bearer_token_encrypted?: string;
  comfyui_workflow_json?: string;
  comfyui_prompt_path?: string;
  comfyui_negative_prompt_path?: string;
  comfyui_width_path?: string;
  comfyui_height_path?: string;
  comfyui_seed_path?: string;
  title_generation_mode?: string;
  title_generation_profile_id?: string | null;
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
  tokenizer_model: string;
  safety_margin_tokens: number;
  leaf_source_token_limit: number;
  leaf_min_message_count: number;
  merged_min_node_count: number;
  merged_target_tokens: number;
  vision_mode: string;
  provider_kind: string;
  provider_preset_id: string | null;
  github_user_access_token_encrypted: string;
  github_refresh_token_encrypted: string;
  github_token_expires_at: string | null;
  github_refresh_token_expires_at: string | null;
  github_account_login: string | null;
  github_account_name: string | null;
  github_oauth_nonce: string | null;
  created_at: string;
  updated_at: string;
};

type GithubCopilotCredentialInput = {
  githubUserAccessToken: string;
  githubRefreshToken: string;
  githubTokenExpiresAt: string | null;
  githubRefreshTokenExpiresAt: string | null;
  githubAccountLogin: string | null;
  githubAccountName: string | null;
};

function normalizeSearxngBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function getGithubConnectionStatus(profile: ProviderProfile): GithubConnectionStatus {
  if (profile.providerKind !== "github_copilot" || !profile.githubUserAccessTokenEncrypted) {
    return "disconnected";
  }

  if (!profile.githubTokenExpiresAt) {
    return "disconnected";
  }

  const expiresAt = Date.parse(profile.githubTokenExpiresAt);

  if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
    return "expired";
  }

  return Number.isNaN(expiresAt) ? "disconnected" : "connected";
}

function decryptSetting(label: string, encryptedValue?: string) {
  if (!encryptedValue) {
    return "";
  }

  try {
    return decryptValue(encryptedValue);
  } catch (e) {
    console.error(
      `[settings] Failed to decrypt ${label}:`,
      e instanceof Error ? e.message : e
    );
    return "";
  }
}

type GeneralSettingsInput = Partial<
  Pick<
    AppSettings,
    | "conversationRetention"
    | "memoriesEnabled"
    | "memoriesMaxCount"
    | "mcpTimeout"
    | "maxAssistantToolSteps"
    | "sttEngine"
    | "sttProvider"
    | "sttLanguage"
    | "externalSttLanguage"
    | "externalSttApiKey"
    | "webSearchEngine"
    | "exaApiKey"
    | "tavilyApiKey"
    | "searxngBaseUrl"
  >
> & {
  clearExaApiKey?: boolean;
  clearTavilyApiKey?: boolean;
  externalSttApiKeyAction?: "preserve" | "replace" | "clear";
};

type GeneralSettingsValues = Pick<
  AppSettings,
  | "conversationRetention"
  | "memoriesEnabled"
  | "memoriesMaxCount"
  | "mcpTimeout"
  | "maxAssistantToolSteps"
  | "sttEngine"
  | "sttProvider"
  | "sttLanguage"
  | "externalSttLanguage"
  | "externalSttApiKey"
  | "webSearchEngine"
  | "exaApiKey"
  | "tavilyApiKey"
  | "searxngBaseUrl"
>;

function validateGeneralSettings(values: GeneralSettingsValues) {
  return generalSettingsSchema.parse({
    ...values,
    searxngBaseUrl: normalizeSearxngBaseUrl(values.searxngBaseUrl)
  });
}

function normalizeImageGenerationBackend(value: string | null | undefined): ImageGenerationBackend {
  return value === "google_nano_banana" ? value : "disabled";
}

export function parseGeneralSettingsInput(input: unknown) {
  return generalSettingsInputSchema.parse(input);
}

function rowToSettings(row: AppSettingsRow | UserSettingsRow): AppSettings {
  return {
    defaultProviderProfileId: row.default_provider_profile_id || null,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention as AppSettings["conversationRetention"],
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    mcpTimeout: row.mcp_timeout,
    maxAssistantToolSteps: row.max_assistant_tool_steps ?? MAX_ASSISTANT_CONTROL_STEPS,
    sttEngine: (row.stt_engine ?? "browser") as AppSettings["sttEngine"],
    sttProvider: (row.stt_provider ?? DEFAULT_EXTERNAL_STT_PROVIDER) as AppSettings["sttProvider"],
    sttLanguage: (row.stt_language ?? "auto") as AppSettings["sttLanguage"],
    externalSttLanguage: (row.external_stt_language ?? DEFAULT_EXTERNAL_STT_LANGUAGE) as AppSettings["externalSttLanguage"],
    externalSttApiKey: decryptSetting(
      "externalSttApiKey",
      row.external_stt_api_key_encrypted
    ),
    webSearchEngine: (row.web_search_engine ?? "exa") as AppSettings["webSearchEngine"],
    exaApiKey: decryptSetting("exaApiKey", row.exa_api_key_encrypted),
    tavilyApiKey: decryptSetting("tavilyApiKey", row.tavily_api_key_encrypted),
    searxngBaseUrl: normalizeSearxngBaseUrl(row.searxng_base_url ?? ""),
    imageGenerationBackend: normalizeImageGenerationBackend(row.image_generation_backend),
    googleNanoBananaModel:
      (row.google_nano_banana_model ?? "gemini-3.1-flash-image-preview") as AppSettings["googleNanoBananaModel"],
    googleNanoBananaApiKey: decryptSetting(
      "googleNanoBananaApiKey",
      row.google_nano_banana_api_key_encrypted
    ),
    titleGenerationMode: (row.title_generation_mode ?? "same") as AppSettings["titleGenerationMode"],
    titleGenerationProfileId: row.title_generation_profile_id ?? null,
    updatedAt: row.updated_at
  };
}

function normalizeLegacyCompactionThreshold(threshold: number) {
  return Math.abs(threshold - 0.78) < 1e-6
    ? DEFAULT_PROVIDER_SETTINGS.compactionThreshold
    : threshold;
}

function rowToProviderProfile(row: ProviderProfileRow): ProviderProfile {
  return {
    id: row.id,
    providerKind: row.provider_kind as ProviderProfile["providerKind"],
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
    compactionThreshold: normalizeLegacyCompactionThreshold(row.compaction_threshold),
    freshTailCount: row.fresh_tail_count,
    tokenizerModel: row.tokenizer_model as "gpt-tokenizer" | "off",
    safetyMarginTokens: row.safety_margin_tokens,
    leafSourceTokenLimit: row.leaf_source_token_limit,
    leafMinMessageCount: row.leaf_min_message_count,
    mergedMinNodeCount: row.merged_min_node_count,
    mergedTargetTokens: row.merged_target_tokens,
    visionMode: row.vision_mode as VisionMode,
    providerPresetId: row.provider_preset_id as ProviderProfile["providerPresetId"],
    githubUserAccessTokenEncrypted: row.github_user_access_token_encrypted,
    githubRefreshTokenEncrypted: row.github_refresh_token_encrypted,
    githubTokenExpiresAt: row.github_token_expires_at,
    githubRefreshTokenExpiresAt: row.github_refresh_token_expires_at,
    githubAccountLogin: row.github_account_login,
    githubAccountName: row.github_account_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const PROVIDER_PROFILE_COLUMNS = `
  id, name, api_base_url, api_key_encrypted, model, api_mode,
  system_prompt, temperature, max_output_tokens, reasoning_effort,
  reasoning_summary_enabled, model_context_limit, compaction_threshold,
  fresh_tail_count, tokenizer_model, safety_margin_tokens,
  leaf_source_token_limit, leaf_min_message_count, merged_min_node_count,
  merged_target_tokens, vision_mode, provider_kind, provider_preset_id,
  github_user_access_token_encrypted, github_refresh_token_encrypted,
  github_token_expires_at, github_refresh_token_expires_at,
  github_account_login, github_account_name, github_oauth_nonce,
  created_at, updated_at`;

function listProviderProfileRows() {
  return getDb()
    .prepare(
      `SELECT ${PROVIDER_PROFILE_COLUMNS}
      FROM provider_profiles
      ORDER BY created_at ASC`
    )
    .all() as ProviderProfileRow[];
}

function getProviderProfileRow(profileId: string) {
  return getDb()
    .prepare(
      `SELECT ${PROVIDER_PROFILE_COLUMNS}
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
    } catch (e) {
      console.error(`[settings] Failed to decrypt API key for profile ${profile.id}:`, e instanceof Error ? e.message : e);
      apiKey = "";
    }
  }

  return {
    ...profile,
    apiKey
  };
}

export function claimGithubCopilotConnectionAttempt(profileId: string) {
  const nonce = createId("github_oauth");
  const result = getDb()
    .prepare(
      `UPDATE provider_profiles
       SET github_oauth_nonce = ?
       WHERE id = ? AND provider_kind = 'github_copilot'`
    )
    .run(nonce, profileId);

  return result.changes === 1 ? nonce : null;
}

export function updateGithubCopilotCredentialsIfNonceMatches(
  profileId: string,
  expectedNonce: string,
  input: GithubCopilotCredentialInput
) {
  const timestamp = new Date().toISOString();

  const result = getDb()
    .prepare(
      `UPDATE provider_profiles
       SET github_user_access_token_encrypted = ?,
           github_refresh_token_encrypted = ?,
           github_token_expires_at = ?,
           github_refresh_token_expires_at = ?,
           github_account_login = ?,
           github_account_name = ?,
           github_oauth_nonce = NULL,
           updated_at = ?
       WHERE id = ?
         AND provider_kind = 'github_copilot'
         AND github_oauth_nonce = ?`
    )
    .run(
      input.githubUserAccessToken ? encryptValue(input.githubUserAccessToken) : "",
      input.githubRefreshToken ? encryptValue(input.githubRefreshToken) : "",
      input.githubTokenExpiresAt,
      input.githubRefreshTokenExpiresAt,
      input.githubAccountLogin,
      input.githubAccountName,
      timestamp,
      profileId,
      expectedNonce
    );

  return result.changes === 1;
}

export function updateGithubCopilotCredentialsIfRefreshTokenMatches(
  profileId: string,
  expectedRefreshTokenEncrypted: string,
  input: GithubCopilotCredentialInput
) {
  const timestamp = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE provider_profiles
       SET github_user_access_token_encrypted = ?,
           github_refresh_token_encrypted = ?,
           github_token_expires_at = ?,
           github_refresh_token_expires_at = ?,
           github_account_login = ?,
           github_account_name = ?,
           updated_at = ?
       WHERE id = ?
         AND provider_kind = 'github_copilot'
         AND github_refresh_token_encrypted = ?`
    )
    .run(
      input.githubUserAccessToken ? encryptValue(input.githubUserAccessToken) : "",
      input.githubRefreshToken ? encryptValue(input.githubRefreshToken) : "",
      input.githubTokenExpiresAt,
      input.githubRefreshTokenExpiresAt,
      input.githubAccountLogin,
      input.githubAccountName,
      timestamp,
      profileId,
      expectedRefreshTokenEncrypted
    );

  return result.changes === 1;
}

export function clearGithubCopilotCredentials(profileId: string) {
  const timestamp = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE provider_profiles
       SET github_user_access_token_encrypted = '',
           github_refresh_token_encrypted = '',
           github_token_expires_at = NULL,
           github_refresh_token_expires_at = NULL,
           github_account_login = NULL,
           github_account_name = NULL,
           github_oauth_nonce = NULL,
           updated_at = ?
       WHERE id = ?`
    )
    .run(timestamp, profileId);
}

export function parseImageGenerationSettingsInput(input: unknown) {
  return imageGenerationSettingsInputSchema.parse(input);
}

export function updateImageGenerationSettings(input: unknown) {
  const parsed = imageGenerationSettingsInputSchema.parse(input);
  const current = getSettings();
  const currentEncryptedKey = (
    getDb()
      .prepare("SELECT google_nano_banana_api_key_encrypted AS value FROM app_settings WHERE id = ?")
      .get(SETTINGS_ROW_ID) as { value: string }
  ).value;
  const keyAction = parsed.googleNanoBananaApiKeyAction ??
    (parsed.googleNanoBananaApiKey === undefined
      ? "preserve"
      : parsed.googleNanoBananaApiKey.trim()
        ? "replace"
        : "clear");
  const googleNanoBananaApiKey = keyAction === "preserve"
    ? current.googleNanoBananaApiKey
    : keyAction === "replace"
      ? parsed.googleNanoBananaApiKey!.trim()
      : "";
  const merged = {
    ...current,
    ...parsed,
    googleNanoBananaApiKey,
    updatedAt: new Date().toISOString()
  };

  getDb()
    .prepare(
      `UPDATE app_settings
       SET image_generation_backend = ?,
           google_nano_banana_model = ?,
           google_nano_banana_api_key_encrypted = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      merged.imageGenerationBackend,
      merged.googleNanoBananaModel,
      keyAction === "preserve"
        ? currentEncryptedKey
        : googleNanoBananaApiKey
          ? encryptValue(googleNanoBananaApiKey)
          : "",
      merged.updatedAt,
      SETTINGS_ROW_ID
    );

  return getSettings();
}

export function getSettings() {
  const row = getDb()
    .prepare(
      `SELECT
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        memories_enabled,
        memories_max_count,
        mcp_timeout,
        image_generation_backend,
        google_nano_banana_model,
        google_nano_banana_api_key_encrypted,
        comfyui_base_url,
        comfyui_auth_type,
        comfyui_bearer_token_encrypted,
        comfyui_workflow_json,
        comfyui_prompt_path,
        comfyui_negative_prompt_path,
        comfyui_width_path,
        comfyui_height_path,
        comfyui_seed_path,
        title_generation_mode,
        title_generation_profile_id,
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as AppSettingsRow;

  return rowToSettings(row);
}

export function updateTitleGenerationSettings(input: {
  titleGenerationMode: "same" | "specific" | "local";
  titleGenerationProfileId?: string | null;
}) {
  const current = getSettings();
  const updatedAt = new Date().toISOString();
  const profileId = input.titleGenerationMode === "specific"
    ? (input.titleGenerationProfileId ?? current.titleGenerationProfileId)
    : null;

  getDb()
    .prepare(
      `UPDATE app_settings
       SET title_generation_mode = ?,
           title_generation_profile_id = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.titleGenerationMode,
      profileId,
      updatedAt,
      SETTINGS_ROW_ID
    );

  return getSettings();
}

function ensureUserSettingsRow(userId: string) {
  const settings = getDb()
    .prepare(
      `SELECT
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        memories_enabled,
        memories_max_count,
        mcp_timeout,
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as AppSettingsRow;

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_settings (
        user_id,
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        memories_enabled,
        memories_max_count,
        mcp_timeout,
        stt_engine,
        stt_provider,
        stt_language,
        external_stt_language,
        external_stt_api_key_encrypted,
        web_search_engine,
        exa_api_key_encrypted,
        tavily_api_key_encrypted,
        searxng_base_url,
        max_assistant_tool_steps,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      settings.default_provider_profile_id,
      settings.skills_enabled,
      settings.conversation_retention,
      settings.auto_compaction,
      settings.memories_enabled,
      settings.memories_max_count,
      settings.mcp_timeout,
      "browser",
      DEFAULT_EXTERNAL_STT_PROVIDER,
      "auto",
      DEFAULT_EXTERNAL_STT_LANGUAGE,
      "",
      "exa",
      "",
      "",
      "",
      MAX_ASSISTANT_CONTROL_STEPS,
      new Date().toISOString()
    );
}

function getUserSettingsRow(userId: string) {
  ensureUserSettingsRow(userId);

  return getDb()
    .prepare(
      `SELECT
        user_id,
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        memories_enabled,
        memories_max_count,
        mcp_timeout,
        stt_engine,
        stt_provider,
        stt_language,
        external_stt_language,
        external_stt_api_key_encrypted,
        web_search_engine,
        exa_api_key_encrypted,
        tavily_api_key_encrypted,
        searxng_base_url,
        max_assistant_tool_steps,
        updated_at
      FROM user_settings
      WHERE user_id = ?`
    )
    .get(userId) as UserSettingsRow;
}

export function getSettingsForUser(userId: string): AppSettings {
  const globalSettings = getSettings();
  const row = getUserSettingsRow(userId);
  const userSettings = rowToSettings(row);

  return {
    ...userSettings,
    defaultProviderProfileId: globalSettings.defaultProviderProfileId,
    skillsEnabled: globalSettings.skillsEnabled,
    imageGenerationBackend: globalSettings.imageGenerationBackend,
    googleNanoBananaModel: globalSettings.googleNanoBananaModel,
    googleNanoBananaApiKey: globalSettings.googleNanoBananaApiKey,
    titleGenerationMode: globalSettings.titleGenerationMode,
    titleGenerationProfileId: globalSettings.titleGenerationProfileId,
    updatedAt: globalSettings.updatedAt
  };
}

export function listProviderProfiles() {
  return listProviderProfileRows().map(rowToProviderProfile);
}

export function listProviderProfilesWithApiKeys() {
  return listProviderProfiles().map(withApiKey);
}

export function duplicateProviderProfile(sourceProfileId: string) {
  const source = getProviderProfileRow(sourceProfileId);
  if (!source) {
    throw new Error("Provider profile not found");
  }

  const existingProfiles = listProviderProfiles();
  const existingNames = new Set(
    existingProfiles.map((p) => p.name.trim().toLowerCase())
  );

  const baseName = source.name;
  let name = `${baseName} copy`;
  let suffix = 2;
  while (existingNames.has(name.trim().toLowerCase())) {
    name = `${baseName} copy ${suffix}`;
    suffix++;
  }

  const newId = `profile_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();

  getDb()
    .prepare(
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
        tokenizer_model,
        safety_margin_tokens,
        leaf_source_token_limit,
        leaf_min_message_count,
        merged_min_node_count,
        merged_target_tokens,
        vision_mode,
        provider_kind,
        provider_preset_id,
        github_user_access_token_encrypted,
        github_refresh_token_encrypted,
        github_token_expires_at,
        github_refresh_token_expires_at,
        github_account_login,
        github_account_name,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?
      )`
    )
    .run(
      newId,
      name,
      source.api_base_url,
      source.api_key_encrypted,
      source.model,
      source.api_mode,
      source.system_prompt,
      source.temperature,
      source.max_output_tokens,
      source.reasoning_effort,
      source.reasoning_summary_enabled ? 1 : 0,
      source.model_context_limit,
      source.compaction_threshold,
      source.fresh_tail_count,
      source.tokenizer_model,
      source.safety_margin_tokens,
      source.leaf_source_token_limit,
      source.leaf_min_message_count,
      source.merged_min_node_count,
      source.merged_target_tokens,
      source.vision_mode,
      source.provider_kind,
      source.provider_preset_id,
      "",
      "",
      null,
      null,
      null,
      null,
      timestamp,
      timestamp
    );

  return getSanitizedSettings();
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
  return settings.defaultProviderProfileId
    ? getProviderProfile(settings.defaultProviderProfileId)
    : null;
}

export function getDefaultProviderProfileWithApiKey() {
  const settings = getSettings();
  return settings.defaultProviderProfileId
    ? getProviderProfileWithApiKey(settings.defaultProviderProfileId)
    : null;
}

export function getSanitizedSettings(userId?: string) {
  const settings = userId ? getSettingsForUser(userId) : getSettings();
  const providerProfiles = listProviderProfiles().map((profile) => {
    const {
      apiKeyEncrypted: _apiKeyEncrypted,
      githubUserAccessTokenEncrypted: _githubUserAccessTokenEncrypted,
      githubRefreshTokenEncrypted: _githubRefreshTokenEncrypted,
      ...sanitizedProfile
    } = profile;

    return {
      ...sanitizedProfile,
      hasApiKey: Boolean(profile.apiKeyEncrypted),
      githubConnectionStatus: getGithubConnectionStatus(profile)
    };
  });

  return {
    ...settings,
    externalSttApiKey: "",
    hasExternalSttApiKey: Boolean(settings.externalSttApiKey),
    exaApiKey: "",
    tavilyApiKey: "",
    hasExaApiKey: Boolean(settings.exaApiKey),
    hasTavilyApiKey: Boolean(settings.tavilyApiKey),
    googleNanoBananaApiKey: "",
    hasGoogleNanoBananaApiKey: Boolean(settings.googleNanoBananaApiKey),
    providerProfiles
  };
}

export function updateGeneralSettingsForUser(
  userId: string,
  input: GeneralSettingsInput
) {
  const currentRow = getUserSettingsRow(userId);
  const current = getSettingsForUser(userId);
  const sttProvider = input.sttProvider ?? current.sttProvider;
  const hasChangedSttProvider = sttProvider !== current.sttProvider;
  const requestedExternalSttApiKeyAction = input.externalSttApiKeyAction ??
    (input.externalSttApiKey?.trim() ? "replace" : "preserve");
  const externalSttApiKeyAction =
    hasChangedSttProvider && requestedExternalSttApiKeyAction === "preserve"
      ? "clear"
      : requestedExternalSttApiKeyAction;
  const externalSttApiKey = externalSttApiKeyAction === "clear"
    ? ""
    : externalSttApiKeyAction === "replace"
      ? input.externalSttApiKey?.trim() ?? ""
      : current.externalSttApiKey;
  const shouldClearExaApiKey = input.clearExaApiKey === true;
  const shouldClearTavilyApiKey = input.clearTavilyApiKey === true;
  const shouldPreserveExaApiKey =
    input.exaApiKey === "" && !shouldClearExaApiKey && Boolean(currentRow.exa_api_key_encrypted);
  const shouldPreserveTavilyApiKey =
    input.tavilyApiKey === "" &&
    !shouldClearTavilyApiKey &&
    Boolean(currentRow.tavily_api_key_encrypted);
  const exaApiKey =
    shouldClearExaApiKey
      ? ""
      : input.exaApiKey === undefined || shouldPreserveExaApiKey
      ? current.exaApiKey
      : input.exaApiKey;
  const tavilyApiKey =
    shouldClearTavilyApiKey
      ? ""
      : input.tavilyApiKey === undefined || shouldPreserveTavilyApiKey
      ? current.tavilyApiKey
      : input.tavilyApiKey;
  const validated = validateGeneralSettings({
    conversationRetention: input.conversationRetention ?? current.conversationRetention,
    memoriesEnabled: input.memoriesEnabled ?? current.memoriesEnabled,
    memoriesMaxCount: input.memoriesMaxCount ?? current.memoriesMaxCount,
    mcpTimeout: input.mcpTimeout ?? current.mcpTimeout,
    maxAssistantToolSteps: input.maxAssistantToolSteps ?? current.maxAssistantToolSteps,
    sttEngine: input.sttEngine ?? current.sttEngine,
    sttProvider,
    sttLanguage: input.sttLanguage ?? current.sttLanguage,
    externalSttLanguage:
      input.externalSttLanguage ??
      (hasChangedSttProvider
        ? getExternalSttProviderConfig(sttProvider).languages[0].value
        : current.externalSttLanguage),
    externalSttApiKey:
      externalSttApiKeyAction === "preserve" &&
      !externalSttApiKey &&
      Boolean(currentRow.external_stt_api_key_encrypted)
        ? "__preserved_external_stt_api_key__"
        : externalSttApiKey,
    webSearchEngine: input.webSearchEngine ?? current.webSearchEngine,
    exaApiKey,
    tavilyApiKey:
      shouldPreserveTavilyApiKey && !current.tavilyApiKey
        ? "__preserved_tavily_api_key__"
        : tavilyApiKey,
    searxngBaseUrl: input.searxngBaseUrl ?? current.searxngBaseUrl
  });
  const next = {
    ...current,
    ...validated,
    externalSttApiKey,
    exaApiKey,
    tavilyApiKey,
    updatedAt: new Date().toISOString()
  };
  const exaApiKeyEncrypted =
    shouldClearExaApiKey
      ? ""
      : input.exaApiKey !== undefined && !shouldPreserveExaApiKey
      ? next.exaApiKey
        ? encryptValue(next.exaApiKey)
        : ""
      : currentRow.exa_api_key_encrypted;
  const tavilyApiKeyEncrypted =
    shouldClearTavilyApiKey
      ? ""
      : input.tavilyApiKey !== undefined && !shouldPreserveTavilyApiKey
      ? next.tavilyApiKey
        ? encryptValue(next.tavilyApiKey)
        : ""
      : currentRow.tavily_api_key_encrypted;
  const externalSttApiKeyEncrypted = externalSttApiKeyAction === "clear"
    ? ""
    : externalSttApiKeyAction === "replace"
      ? externalSttApiKey
        ? encryptValue(externalSttApiKey)
        : ""
      : currentRow.external_stt_api_key_encrypted;

  getDb()
    .prepare(
      `UPDATE user_settings
       SET default_provider_profile_id = ?,
           skills_enabled = ?,
           conversation_retention = ?,
           memories_enabled = ?,
           memories_max_count = ?,
           mcp_timeout = ?,
           max_assistant_tool_steps = ?,
           stt_engine = ?,
           stt_provider = ?,
           stt_language = ?,
           external_stt_language = ?,
           external_stt_api_key_encrypted = ?,
           web_search_engine = ?,
           exa_api_key_encrypted = ?,
           tavily_api_key_encrypted = ?,
           searxng_base_url = ?,
           updated_at = ?
       WHERE user_id = ?`
    )
    .run(
      current.defaultProviderProfileId,
      current.skillsEnabled ? 1 : 0,
      next.conversationRetention,
      next.memoriesEnabled ? 1 : 0,
      next.memoriesMaxCount,
      next.mcpTimeout,
      next.maxAssistantToolSteps,
      next.sttEngine,
      next.sttProvider,
      next.sttLanguage,
      next.externalSttLanguage,
      externalSttApiKeyEncrypted,
      next.webSearchEngine,
      exaApiKeyEncrypted,
      tavilyApiKeyEncrypted,
      next.searxngBaseUrl,
      next.updatedAt,
      userId
    );

  return getSettingsForUser(userId);
}

export function updateGeneralSettingsBundleForUser(
  userId: string,
  input: unknown,
  canManageGlobalSettings: boolean
) {
  const parsed = generalSettingsBundleInputSchema.parse(input);

  if (!canManageGlobalSettings && (parsed.imageGeneration || parsed.titleGeneration)) {
    throw new Error("Only admins can update global settings");
  }

  const transaction = getDb().transaction(() => {
    updateGeneralSettingsForUser(userId, parsed.general);

    if (parsed.imageGeneration) {
      updateImageGenerationSettings(parsed.imageGeneration);
    }

    if (parsed.titleGeneration) {
      updateTitleGenerationSettings(parsed.titleGeneration);
    }
  });

  transaction();
  return getSanitizedSettings(userId);
}

export function updateSettings(input: unknown) {
  const currentProfileRows = new Map(
    listProviderProfileRows().map((profile) => [profile.id, profile])
  );
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
        tokenizer_model,
        safety_margin_tokens,
        leaf_source_token_limit,
        leaf_min_message_count,
        merged_min_node_count,
        merged_target_tokens,
        vision_mode,
        provider_kind,
        provider_preset_id,
        github_user_access_token_encrypted,
        github_refresh_token_encrypted,
        github_token_expires_at,
        github_refresh_token_expires_at,
        github_account_login,
        github_account_name,
        github_oauth_nonce,
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
        @tokenizerModel,
        @safetyMarginTokens,
        @leafSourceTokenLimit,
        @leafMinMessageCount,
        @mergedMinNodeCount,
        @mergedTargetTokens,
        @visionMode,
        @providerKind,
        @providerPresetId,
        @githubUserAccessTokenEncrypted,
        @githubRefreshTokenEncrypted,
        @githubTokenExpiresAt,
        @githubRefreshTokenExpiresAt,
        @githubAccountLogin,
        @githubAccountName,
        @githubOauthNonce,
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
        tokenizer_model = excluded.tokenizer_model,
        safety_margin_tokens = excluded.safety_margin_tokens,
        leaf_source_token_limit = excluded.leaf_source_token_limit,
        leaf_min_message_count = excluded.leaf_min_message_count,
        merged_min_node_count = excluded.merged_min_node_count,
        merged_target_tokens = excluded.merged_target_tokens,
        vision_mode = excluded.vision_mode,
        provider_kind = excluded.provider_kind,
        provider_preset_id = excluded.provider_preset_id,
        github_user_access_token_encrypted = excluded.github_user_access_token_encrypted,
        github_refresh_token_encrypted = excluded.github_refresh_token_encrypted,
        github_token_expires_at = excluded.github_token_expires_at,
        github_refresh_token_expires_at = excluded.github_refresh_token_expires_at,
        github_account_login = excluded.github_account_login,
        github_account_name = excluded.github_account_name,
        github_oauth_nonce = excluded.github_oauth_nonce,
        updated_at = excluded.updated_at`
    );

    parsed.providerProfiles.forEach((profile) => {
      const current = currentProfiles.get(profile.id);
      const currentRow = currentProfileRows.get(profile.id);
      const providerIdentityChanged = Boolean(
        current && (
          current.providerKind !== profile.providerKind ||
          current.apiBaseUrl !== profile.apiBaseUrl ||
          current.providerPresetId !== profile.providerPresetId
        )
      );
      const requestedApiKeyAction = profile.apiKeyAction ??
        (profile.apiKey
          ? "replace"
          : providerIdentityChanged
            ? "clear"
            : current
              ? "preserve"
              : "clear");

      if (requestedApiKeyAction === "replace" && !profile.apiKey.trim()) {
        throw new Error(`Provider ${profile.name} requires an API key when replacing credentials`);
      }

      if (requestedApiKeyAction === "preserve" && providerIdentityChanged && current?.apiKeyEncrypted) {
        throw new Error(`Provider ${profile.name} changed connection identity; replace or clear its API key`);
      }

      const apiKeyEncrypted = requestedApiKeyAction === "preserve"
        ? current?.apiKeyEncrypted ?? ""
        : requestedApiKeyAction === "replace"
          ? encryptValue(profile.apiKey.trim())
          : "";
      const canUseGithubCredentials = profile.providerKind === "github_copilot" &&
        (!current || current.providerKind === "github_copilot");
      const githubUserAccessTokenEncrypted = canUseGithubCredentials
        ? profile.githubUserAccessTokenEncrypted || current?.githubUserAccessTokenEncrypted || ""
        : "";
      const githubRefreshTokenEncrypted = canUseGithubCredentials
        ? profile.githubRefreshTokenEncrypted || current?.githubRefreshTokenEncrypted || ""
        : "";
      const githubTokenExpiresAt = canUseGithubCredentials
        ? profile.githubTokenExpiresAt ?? current?.githubTokenExpiresAt ?? null
        : null;
      const githubRefreshTokenExpiresAt = canUseGithubCredentials
        ? profile.githubRefreshTokenExpiresAt ?? current?.githubRefreshTokenExpiresAt ?? null
        : null;
      const githubAccountLogin = canUseGithubCredentials
        ? profile.githubAccountLogin ?? current?.githubAccountLogin ?? null
        : null;
      const githubAccountName = canUseGithubCredentials
        ? profile.githubAccountName ?? current?.githubAccountName ?? null
        : null;
      const githubOauthNonce = profile.providerKind === "github_copilot" &&
        current?.providerKind === "github_copilot"
        ? currentRow?.github_oauth_nonce ?? null
        : null;

      upsertProfile.run({
        id: profile.id,
        name: profile.name,
        apiBaseUrl: profile.apiBaseUrl,
        apiKeyEncrypted,
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
        tokenizerModel: profile.tokenizerModel,
        safetyMarginTokens: profile.safetyMarginTokens,
        leafSourceTokenLimit: profile.leafSourceTokenLimit,
        leafMinMessageCount: profile.leafMinMessageCount,
        mergedMinNodeCount: profile.mergedMinNodeCount,
        mergedTargetTokens: profile.mergedTargetTokens,
        visionMode: profile.visionMode ?? "native",
        providerKind: profile.providerKind,
        providerPresetId: profile.providerPresetId ?? null,
        githubUserAccessTokenEncrypted,
        githubRefreshTokenEncrypted,
        githubTokenExpiresAt,
        githubRefreshTokenExpiresAt,
        githubAccountLogin,
        githubAccountName,
        githubOauthNonce,
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
        .prepare(
          `UPDATE automations
           SET provider_profile_id = ?, updated_at = ?
           WHERE provider_profile_id IN (${placeholders})`
        )
        .run(parsed.defaultProviderProfileId, timestamp, ...removedProfileIds);

      getDb()
        .prepare(
          `UPDATE app_settings
           SET title_generation_mode = 'same',
               title_generation_profile_id = NULL,
               updated_at = ?
           WHERE title_generation_profile_id IN (${placeholders})`
        )
        .run(timestamp, ...removedProfileIds);

      getDb()
        .prepare(`DELETE FROM provider_profiles WHERE id IN (${placeholders})`)
        .run(...removedProfileIds);
    }

    getDb()
      .prepare(
        `UPDATE app_settings
         SET default_provider_profile_id = ?,
             skills_enabled = ?,
             conversation_retention = ?,
             memories_enabled = ?,
             memories_max_count = ?,
             mcp_timeout = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        parsed.defaultProviderProfileId,
        parsed.skillsEnabled ? 1 : 0,
        parsed.conversationRetention,
        parsed.memoriesEnabled ? 1 : 0,
        parsed.memoriesMaxCount,
        parsed.mcpTimeout,
        timestamp,
        SETTINGS_ROW_ID
      );
  });

  transaction();

  return getSanitizedSettings();
}

export function updateProviderCatalog(input: unknown) {
  return updateSettings(input);
}

export function getSettingsDefaults() {
  return {
    name: DEFAULT_PROVIDER_PROFILE_NAME,
    ...DEFAULT_PROVIDER_SETTINGS
  };
}
