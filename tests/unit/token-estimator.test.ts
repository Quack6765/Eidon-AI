import { createTokenizer } from "@/lib/token-estimator";

describe("token estimator", () => {
  it("counts tokens using gpt-tokenizer", () => {
    const tokenizer = createTokenizer("gpt-tokenizer");
    expect(tokenizer.estimateTextTokens("hello world")).toBeGreaterThan(0);
  });

  it("falls back to char estimation when tokenizer is off", () => {
    const tokenizer = createTokenizer("off");
    const tokens = tokenizer.estimateTextTokens("hello world");
    expect(tokens).toBeGreaterThan(0);
    // char count / 4 approximation: "hello world" = 11 chars → 2.75 → Math.ceil = 3
    expect(tokens).toBe(Math.ceil(11 / 4));
  });

  it("returns default gpt-tokenizer for unknown engine", () => {
    const tokenizer = createTokenizer("nonexistent" as any);
    expect(tokenizer).not.toBeNull();
    const result = tokenizer.estimateTextTokens("test");
    expect(result).toBeGreaterThan(0);
  });

  it("returns 0 for empty or whitespace-only text with off tokenizer", () => {
    const tokenizer = createTokenizer("off");
    expect(tokenizer.estimateTextTokens("   ")).toBe(0);
    expect(tokenizer.estimateTextTokens("")).toBe(0);
  });

  it("estimates tokens for image attachments using gpt-tokenizer", () => {
    const tokenizer = createTokenizer("gpt-tokenizer");
    const tokens = tokenizer.estimateAttachmentTokens([
      { id: "a1", conversationId: "c1", messageId: null, kind: "image", filename: "photo.png", mimeType: "image/png", byteSize: 100, sha256: "hash", relativePath: "c1/a1.png", extractedText: "", createdAt: "" }
    ]);
    expect(tokens).toBeGreaterThan(0);
  });
});
