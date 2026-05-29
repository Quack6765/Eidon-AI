export type ModelCapabilityOverride = {
  prefix: string;
  reasoning?: boolean | { apiModes: Array<"responses" | "chat_completions"> };
  vision?: boolean | { apiModes: Array<"responses" | "chat_completions"> };
  thinkingReplay?: boolean;
  extraBody?: "none" | "thinking" | "reasoning_effort";
  strictExtraRejection?: boolean;
};

export const MODEL_REGISTRY: ModelCapabilityOverride[] = [
  { prefix: "gpt-5", reasoning: { apiModes: ["responses"] }, vision: true, extraBody: "thinking" },
  { prefix: "o1", reasoning: { apiModes: ["responses"] }, vision: true, extraBody: "thinking" },
  { prefix: "o3", reasoning: { apiModes: ["responses"] }, vision: true, extraBody: "thinking" },
  { prefix: "o4", reasoning: { apiModes: ["responses"] }, vision: true, extraBody: "thinking" },
  { prefix: "gpt-oss", reasoning: { apiModes: ["responses"] }, vision: { apiModes: ["responses"] }, extraBody: "thinking" },
  { prefix: "gpt-4.1", vision: true },
  { prefix: "gpt-4o", vision: true },
  { prefix: "glm-5v", reasoning: true, vision: true, extraBody: "thinking" },
  { prefix: "glm-5", reasoning: true, extraBody: "thinking" },
  { prefix: "glm-4.7", reasoning: true, extraBody: "thinking" },
  { prefix: "kimi-", reasoning: true, vision: true, strictExtraRejection: true },
  { prefix: "deepseek-", reasoning: { apiModes: ["chat_completions"] }, thinkingReplay: true, extraBody: "thinking" },
  { prefix: "claude-opus", reasoning: true, vision: true },
  { prefix: "claude-sonnet", reasoning: true, vision: true },
  { prefix: "claude-haiku", reasoning: true, vision: true },
  { prefix: "claude-3", vision: true },
  { prefix: "claude-4", reasoning: true, vision: true },
  { prefix: "gemini", vision: true },
];
