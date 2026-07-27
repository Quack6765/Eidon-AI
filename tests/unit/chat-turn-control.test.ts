describe("chat turn control", () => {
  it("shares one active-turn registry across module instances", async () => {
    const conversationId = `conv_global_${Date.now()}`;
    const firstModule = await import("@/lib/chat-turn-control");
    const firstClaim = firstModule.claimChatTurnStart(conversationId);
    expect(firstClaim.ok).toBe(true);

    vi.resetModules();
    const secondModule = await import("@/lib/chat-turn-control");
    expect(secondModule.claimChatTurnStart(conversationId)).toEqual({ ok: false });

    if (firstClaim.ok) {
      secondModule.releaseChatTurnStart(conversationId, firstClaim.control);
    }
    expect(secondModule.claimChatTurnStart(conversationId).ok).toBe(true);
    secondModule.clearChatTurn(conversationId);
  });
});
