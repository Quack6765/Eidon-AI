import { estimatePromptTokens, estimateTextTokens } from "@/lib/tokenization";

describe("token estimation", () => {
  it("returns higher token counts for larger inputs", () => {
    const short = estimateTextTokens("hello");
    const long = estimateTextTokens("hello ".repeat(100));

    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("returns zero tokens for blank input", () => {
    expect(estimateTextTokens("   ")).toBe(0);
  });

  it("estimates prompt tokens across messages", () => {
    const tokens = estimatePromptTokens([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Write a haiku about sqlite" }
    ]);

    expect(tokens).toBeGreaterThan(10);
  });
});
