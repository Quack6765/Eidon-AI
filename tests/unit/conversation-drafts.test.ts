const dispatchConversationRemoved = vi.fn();

vi.mock("@/lib/conversation-events", () => ({
  dispatchConversationRemoved
}));

describe("conversation drafts", () => {
  beforeEach(() => {
    dispatchConversationRemoved.mockReset();
    global.fetch = vi.fn();
  });

  it("returns false when the conversation id is missing", async () => {
    const { deleteConversationIfStillEmpty } = await import("@/lib/conversation-drafts");

    await expect(deleteConversationIfStillEmpty(null)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns false when deletion fails or the conversation stays present", async () => {
    const { deleteConversationIfStillEmpty } = await import("@/lib/conversation-drafts");

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deleted: false })
      } as Response);

    await expect(deleteConversationIfStillEmpty("conv_1")).resolves.toBe(false);
    await expect(deleteConversationIfStillEmpty("conv_1")).resolves.toBe(false);
    expect(dispatchConversationRemoved).not.toHaveBeenCalled();
  });

  it("dispatches a removal event when the draft is deleted", async () => {
    const { deleteConversationIfStillEmpty } = await import("@/lib/conversation-drafts");

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true })
    } as Response);

    await expect(deleteConversationIfStillEmpty("conv_2")).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/conversations/conv_2?onlyIfEmpty=1",
      expect.objectContaining({
        method: "DELETE",
        keepalive: true
      })
    );
    expect(dispatchConversationRemoved).toHaveBeenCalledWith({
      conversationId: "conv_2"
    });
  });
});
