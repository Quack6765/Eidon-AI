export type ModelCapabilityOverride = {
  prefix: string;
  reasoning?: boolean | { apiModes: Array<"responses" | "chat_completions"> };
  vision?: boolean | { apiModes: Array<"responses" | "chat_completions"> };
  supportsTemperature?: boolean;
};

export type ModelRequestQuirk = {
  prefix: string;
  thinkingReplay?: boolean;
  extraBody?: "none" | "thinking" | "reasoning_effort";
  strictExtraRejection?: boolean;
};

export const MODEL_REGISTRY: ModelCapabilityOverride[] = [
  {
    prefix: "gpt-5",
    reasoning: { apiModes: ["responses"] },
    vision: true,
    supportsTemperature: false
  },
  { prefix: "o1", reasoning: { apiModes: ["responses"] }, vision: true },
  { prefix: "o3", reasoning: { apiModes: ["responses"] }, vision: true },
  { prefix: "o4", reasoning: { apiModes: ["responses"] }, vision: true },
  { prefix: "gpt-oss", reasoning: { apiModes: ["responses"] }, vision: { apiModes: ["responses"] } },
  { prefix: "gpt-4.1", vision: true },
  { prefix: "gpt-4o", vision: true },
  { prefix: "glm-5v", reasoning: true, vision: true },
  { prefix: "glm-5", reasoning: true },
  { prefix: "glm-4.7", reasoning: true },
  { prefix: "kimi-", reasoning: true, vision: true },
  { prefix: "deepseek-", reasoning: { apiModes: ["chat_completions"] } },
  { prefix: "mimo-", reasoning: true, vision: true },
  { prefix: "claude-opus", reasoning: true, vision: true },
  { prefix: "claude-sonnet", reasoning: true, vision: true },
  { prefix: "claude-haiku", reasoning: true, vision: true },
  { prefix: "claude-3", vision: true },
  { prefix: "claude-4", reasoning: true, vision: true },
  { prefix: "gemini", vision: true },
];

export const MODEL_REQUEST_QUIRKS: ModelRequestQuirk[] = [
  { prefix: "gpt-5", extraBody: "thinking" },
  { prefix: "o1", extraBody: "thinking" },
  { prefix: "o3", extraBody: "thinking" },
  { prefix: "o4", extraBody: "thinking" },
  { prefix: "gpt-oss", extraBody: "thinking" },
  { prefix: "glm-5v", extraBody: "thinking" },
  { prefix: "glm-5", extraBody: "thinking" },
  { prefix: "glm-4.7", extraBody: "thinking" },
  { prefix: "kimi-", strictExtraRejection: true },
  { prefix: "deepseek-", thinkingReplay: true, extraBody: "thinking" },
  { prefix: "mimo-", thinkingReplay: true, extraBody: "thinking" }
];
