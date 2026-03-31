export const APP_NAME = "Hermes";
export const SESSION_COOKIE_NAME = "hermes_session";
export const SETTINGS_ROW_ID = 1;
export const DEFAULT_PROVIDER_PROFILE_NAME = "Default profile";
export const SAFETY_MARGIN_TOKENS = 1200;
export const LEAF_TARGET_TOKENS = 1200;
export const LEAF_SOURCE_TOKEN_LIMIT = 12000;
export const MERGED_TARGET_TOKENS = 1600;
export const LEAF_MIN_MESSAGE_COUNT = 6;
export const MERGED_MIN_NODE_COUNT = 4;
export const DEFAULT_PROVIDER_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  apiMode: "responses",
  systemPrompt:
    "You are a precise, practical assistant. Answer clearly and directly.",
  temperature: 0.7,
  maxOutputTokens: 1200,
  reasoningEffort: "medium",
  reasoningSummaryEnabled: true,
  modelContextLimit: 128000,
  compactionThreshold: 0.78,
  freshTailCount: 28
} as const;
