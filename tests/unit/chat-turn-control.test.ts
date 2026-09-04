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

  it("resolves release waiters when the active turn ends", async () => {
    const conversationId = `conv_wait_${Date.now()}`;
    const control = await import("@/lib/chat-turn-control");

    await expect(control.waitForChatTurnRelease(conversationId, 1_000)).resolves.toBeUndefined();

    const claimed = control.claimChatTurnStart(conversationId);
    expect(claimed.ok).toBe(true);

    let released = false;
    const waiting = control.waitForChatTurnRelease(conversationId, 5_000).then(() => {
      released = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(released).toBe(false);

    if (claimed.ok) control.releaseChatTurnStart(conversationId, claimed.control);
    await waiting;
    expect(released).toBe(true);
    expect(control.hasActiveChatTurn(conversationId)).toBe(false);
  });

  it("falls back to the timeout when no release arrives", async () => {
    const conversationId = `conv_timeout_${Date.now()}`;
    const control = await import("@/lib/chat-turn-control");
    const claimed = control.claimChatTurnStart(conversationId);
    expect(claimed.ok).toBe(true);

    const startedAt = Date.now();
    await control.waitForChatTurnRelease(conversationId, 20);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);

    control.clearChatTurn(conversationId);
  });
});
