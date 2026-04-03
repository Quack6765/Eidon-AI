import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  verifySessionToken: vi.fn()
}));

vi.mock("@/lib/conversations", () => ({
  getConversationSnapshot: vi.fn(),
  listActiveConversations: vi.fn()
}));

describe("ws-handler", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("sends an error and closes the connection when auth fails", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, "session=invalid");

    expect(ws.close).toHaveBeenCalled();
    const error = sent.find(s => JSON.parse(s).type === "error");
    expect(error).toBeDefined();
    expect(JSON.parse(error!).type).toBe("error");
  });

  it("sends ready and handles subscribe", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const { getConversationSnapshot, listActiveConversations } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: []
    });

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      addEventListener: vi.fn((_event: string, handler: (...args: unknown[]) => void) => {
        if (_event === "message") messageHandlers.push((d: string) => handler({ data: d }));
      }),
      removeEventListener: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    const ready = sent.find(s => JSON.parse(s).type === "ready");
    expect(ready).toBeDefined();
    expect(JSON.parse(ready!).type).toBe("ready");

    const subscribeMsg = JSON.stringify({ type: "subscribe", conversationId: "conv-1" });
    for (const handler of messageHandlers) handler(subscribeMsg);

    const snapshot = sent.find(s => JSON.parse(s).type === "snapshot");
    expect(snapshot).toBeDefined();
    expect(JSON.parse(snapshot!).conversationId).toBe("conv-1");
    expect(getConversationSnapshot).toHaveBeenCalledWith("conv-1");
  });

  it("sends error and closes when no token provided", async () => {
    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, null);

    expect(ws.close).toHaveBeenCalled();
    const error = sent.find(s => JSON.parse(s).type === "error");
    expect(error).toBeDefined();
  });
});
