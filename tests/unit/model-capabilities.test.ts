import { getDefaultVisionMode, resolveCapabilities, supportsImageInput, supportsVisibleReasoning } from "@/lib/model-capabilities";

describe("resolveCapabilities", () => {
  it("returns defaults for unknown models", () => {
    const caps = resolveCapabilities("unknown-model", "chat_completions");
    expect(caps.reasoning).toBe(false);
    expect(caps.vision).toBe(false);
    expect(caps.thinkingReplay).toBe(false);
    expect(caps.extraBody).toBe("none");
    expect(caps.strictExtraRejection).toBe(false);
  });

  it("returns defaults for empty model string", () => {
    const caps = resolveCapabilities("", "responses");
    expect(caps.reasoning).toBe(false);
    expect(caps.vision).toBe(false);
  });

  it("applies registry overrides for kimi", () => {
    const caps = resolveCapabilities("kimi-k2.6", "chat_completions");
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(true);
    expect(caps.strictExtraRejection).toBe(true);
    expect(caps.thinkingReplay).toBe(false);
    expect(caps.extraBody).toBe("none");
  });

  it("applies registry overrides for glm-5", () => {
    const caps = resolveCapabilities("glm-5-turbo", "chat_completions");
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(false);
    expect(caps.extraBody).toBe("thinking");
  });

  it("matches glm-5v before glm-5 for vision", () => {
    const caps = resolveCapabilities("glm-5v-turbo", "chat_completions");
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(true);
  });

  it("applies user overrides on top of registry", () => {
    const caps = resolveCapabilities("kimi-k2.6", "chat_completions", { vision: false });
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(true);
  });

  it("resolves apiMode-constrained reasoning for deepseek", () => {
    expect(resolveCapabilities("deepseek-r1", "chat_completions").reasoning).toBe(true);
    expect(resolveCapabilities("deepseek-r1", "responses").reasoning).toBe(false);
  });

  it("resolves apiMode-constrained vision for gpt-oss", () => {
    expect(resolveCapabilities("gpt-oss-mini", "responses").vision).toBe(true);
    expect(resolveCapabilities("gpt-oss-mini", "chat_completions").vision).toBe(false);
  });

  it("applies thinkingReplay for deepseek", () => {
    expect(resolveCapabilities("deepseek-r1", "chat_completions").thinkingReplay).toBe(true);
    expect(resolveCapabilities("kimi-k2.6", "chat_completions").thinkingReplay).toBe(false);
  });
});

describe("supportsVisibleReasoning", () => {
  it("treats GPT-5 and o-series models as reasoning-capable on responses", () => {
    expect(supportsVisibleReasoning("gpt-5-mini", "responses")).toBe(true);
    expect(supportsVisibleReasoning("gpt-5.4", "responses")).toBe(true);
    expect(supportsVisibleReasoning("o4-mini", "responses")).toBe(true);
    expect(supportsVisibleReasoning("glm-5-turbo", "chat_completions")).toBe(true);
    expect(supportsVisibleReasoning("glm-5.1", "chat_completions")).toBe(true);
    expect(supportsVisibleReasoning("glm-4.7:cloud", "chat_completions")).toBe(true);
  });

  it("treats GPT-4.1 and chat completions as non-reasoning for visible summaries", () => {
    expect(supportsVisibleReasoning("gpt-4.1-mini", "responses")).toBe(false);
    expect(supportsVisibleReasoning("gpt-5-mini", "chat_completions")).toBe(false);
    expect(supportsVisibleReasoning("", "responses")).toBe(false);
  });

  it("treats kimi as reasoning-capable", () => {
    expect(supportsVisibleReasoning("kimi-k2.6", "chat_completions")).toBe(true);
  });

  it("resolves reasoning and vision for claude-opus-4-8", () => {
    expect(supportsVisibleReasoning("claude-opus-4-8", "chat_completions")).toBe(true);
    expect(supportsImageInput("claude-opus-4-8", "chat_completions")).toBe(true);
  });

  it("resolves reasoning and vision for claude-sonnet-4-6", () => {
    expect(supportsVisibleReasoning("claude-sonnet-4-6", "chat_completions")).toBe(true);
    expect(supportsImageInput("claude-sonnet-4-6", "chat_completions")).toBe(true);
  });

  it("resolves reasoning and vision for claude-haiku-4-5", () => {
    expect(supportsVisibleReasoning("claude-haiku-4-5", "chat_completions")).toBe(true);
    expect(supportsImageInput("claude-haiku-4-5", "chat_completions")).toBe(true);
  });
});

describe("supportsImageInput", () => {
  it("detects image-capable models", () => {
    expect(supportsImageInput("gpt-4o-mini", "chat_completions")).toBe(true);
    expect(supportsImageInput("gpt-5-mini", "responses")).toBe(true);
    expect(supportsImageInput("claude-3-7-sonnet", "chat_completions")).toBe(true);
    expect(supportsImageInput("gemini-3-flash-preview", "chat_completions")).toBe(true);
    expect(supportsImageInput("gpt-oss-mini", "responses")).toBe(true);
  });

  it("detects non-image-capable models", () => {
    expect(supportsImageInput("gpt-oss-mini", "chat_completions")).toBe(false);
    expect(supportsImageInput("", "chat_completions")).toBe(false);
    expect(supportsImageInput("gpt-3.5-turbo", "chat_completions")).toBe(false);
  });

  it("kimi has native vision", () => {
    expect(supportsImageInput("kimi-k2.6", "chat_completions")).toBe(true);
  });

  it("glm-5 does not have native vision", () => {
    expect(supportsImageInput("glm-5-turbo", "chat_completions")).toBe(false);
  });

  it("glm-5v-turbo has native vision", () => {
    expect(supportsImageInput("glm-5v-turbo", "chat_completions")).toBe(true);
  });
});

describe("getDefaultVisionMode", () => {
  it("returns native vision for image-capable models and none otherwise", () => {
    expect(getDefaultVisionMode("gpt-4o-mini", "chat_completions")).toBe("native");
    expect(getDefaultVisionMode("gpt-3.5-turbo", "chat_completions")).toBe("none");
  });
});
