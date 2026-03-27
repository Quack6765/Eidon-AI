import { supportsVisibleReasoning } from "@/lib/model-capabilities";

describe("model capabilities", () => {
  it("treats GPT-5 and o-series models as reasoning-capable on responses", () => {
    expect(supportsVisibleReasoning("gpt-5-mini", "responses")).toBe(true);
    expect(supportsVisibleReasoning("gpt-5.4", "responses")).toBe(true);
    expect(supportsVisibleReasoning("o4-mini", "responses")).toBe(true);
    expect(supportsVisibleReasoning("glm-5-turbo", "chat_completions")).toBe(true);
  });

  it("treats GPT-4.1 and chat completions as non-reasoning for visible summaries", () => {
    expect(supportsVisibleReasoning("gpt-4.1-mini", "responses")).toBe(false);
    expect(supportsVisibleReasoning("gpt-5-mini", "chat_completions")).toBe(false);
  });
});
