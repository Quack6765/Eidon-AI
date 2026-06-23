export const APP_NAME = "Eidon";
export const SESSION_COOKIE_NAME = "eidon_session";
export const SETTINGS_ROW_ID = 1;
export const DEFAULT_PROVIDER_PROFILE_NAME = "Default profile";
export const DEFAULT_SKILLS_ENABLED = true;
export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MAX_ASSISTANT_CONTROL_STEPS = 25;
export const MAX_STREAM_RETRIES_PRE = 2;
export const MAX_STREAM_RETRIES_POST = 1;
export const STREAM_RETRY_TOTAL_TIMEOUT_MS = 10_000;
export const STREAM_RETRY_BASE_DELAY_MS = 500;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT_RATIO = 0.25;
export const DEFAULT_PROVIDER_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  apiMode: "responses",
  systemPrompt:
    "You are an helpful AI assistant with advanced reasoning capabilities. You excel at complex problem-solving, analysis, coding, mathematics, and tasks requiring careful, step-by-step thinking.\nWhen responding:\n1. **Think step by step** - Break down complex problems into logical steps. Show your reasoning process clearly before arriving at conclusions.\n2. **Be thorough but concise** - Explore ideas deeply, but avoid unnecessary verbosity. Focus on substantive reasoning over filler text.\n3. **Verify your logic** - Double-check your reasoning for consistency, accuracy, and completeness before finalizing your answer.\n4. **Acknowledge uncertainty** - When appropriate, indicate confidence levels or alternative interpretations of the problem.\n5. **Use structured formats** - For complex answers, use numbered steps, bullet points, or sections to organize your thinking.\n6. **Adapt depth to the task** - Match the depth of your reasoning to the complexity of the question. Simple questions don't need elaborate analysis.\n7. **Use emojis sparingly** - You may use an occasional emoji when it genuinely improves tone or clarity, but keep usage infrequent and minimal. Do not use emojis in every response, avoid repeated or decorative emoji use, and never let them clutter the message.\nAlways aim to be helpful, accurate, and honest in your responses.",
  temperature: 0.7,
  maxOutputTokens: 1200,
  reasoningEffort: "medium",
  reasoningSummaryEnabled: true,
  modelContextLimit: 200000,
  compactionThreshold: 0.8,
  freshTailCount: 28,
  tokenizerModel: "gpt-tokenizer" as const,
  safetyMarginTokens: 1200,
  leafSourceTokenLimit: 12000,
  leafMinMessageCount: 6,
  mergedMinNodeCount: 4,
  mergedTargetTokens: 1600,
  visionMode: "native" as const
} as const;
