import { getDefaultVisionMode, supportsImageInput, supportsVisibleReasoning } from "@/lib/model-capabilities";

describe("model capabilities", () => {
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

  it("detects likely image-capable models", () => {
    expect(supportsImageInput("gpt-4o-mini", "chat_completions")).toBe(true);
    expect(supportsImageInput("gpt-5-mini", "responses")).toBe(true);
    expect(supportsImageInput("claude-3-7-sonnet", "chat_completions")).toBe(true);
    expect(supportsImageInput("gemini-3-flash-preview", "chat_completions")).toBe(true);
    expect(supportsImageInput("gpt-oss-mini", "responses")).toBe(true);
    expect(supportsImageInput("gpt-oss-mini", "chat_completions")).toBe(false);
    expect(supportsImageInput("", "chat_completions")).toBe(false);
    expect(supportsImageInput("gpt-3.5-turbo", "chat_completions")).toBe(false);
  });

  it("returns native vision for image-capable models and none otherwise", () => {
    expect(getDefaultVisionMode("gpt-4o-mini", "chat_completions")).toBe("native");
    expect(getDefaultVisionMode("gpt-3.5-turbo", "chat_completions")).toBe("none");
  });
});
