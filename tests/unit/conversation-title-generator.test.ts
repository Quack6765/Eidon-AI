const runLocalTitleInference = vi.fn();

vi.mock("@/lib/local-title-model", () => ({
  runLocalTitleInference
}));

describe("conversation title generator", () => {
  beforeEach(() => {
    runLocalTitleInference.mockReset();
  });

  it("sanitizes quotes, line breaks, and excessive length", async () => {
    const { sanitizeGeneratedConversationTitle } = await import("@/lib/conversation-title-generator");

    expect(
      sanitizeGeneratedConversationTitle(
        "\"A very long generated title that keeps going far past the maximum length for the sidebar\"\nSecond line"
      )
    ).toBe("A very long generated title that keeps going");
  });

  it("truncates without word boundary when no space exists after position 16", async () => {
    const { sanitizeGeneratedConversationTitle } = await import("@/lib/conversation-title-generator");

    const result = sanitizeGeneratedConversationTitle(
      "Superlongwordthatexceedsthemaxlengthbyfar"
    );
    expect(result).toBe("Superlongwordthatexceedsthemaxlengthbyfar".slice(0, 48));
  });

  it("calls the local model and returns a sanitized title", async () => {
    runLocalTitleInference.mockResolvedValue('  "Deployment Checklist."\n');

    const { generateConversationTitle } = await import("@/lib/conversation-title-generator");
    const title = await generateConversationTitle({
      firstMessage: "Build a deployment checklist for me"
    });

    expect(title).toBe("Deployment Checklist");
    expect(runLocalTitleInference).toHaveBeenCalledWith("Build a deployment checklist for me");
  });

  it("treats empty sanitized output as a failure", async () => {
    runLocalTitleInference.mockResolvedValue('""');

    const { generateConversationTitle } = await import("@/lib/conversation-title-generator");

    await expect(
      generateConversationTitle({
        firstMessage: "Build a deployment checklist for me"
      })
    ).rejects.toThrow("Local model returned an empty title");
  });
});
