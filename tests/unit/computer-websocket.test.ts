import { EventEmitter } from "node:events";
import type { IncomingMessage } from "http";
import type { WebSocketServer } from "ws";

const mocks = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
  verifyMobileSessionToken: vi.fn(),
  getCurrentUser: vi.fn(),
  getConversationOwnerId: vi.fn(),
  attachComputerViewer: vi.fn(),
  conversationBrowserTarget: vi.fn((conversationId: string) => ({ ownerKey: "user_1", sessionName: "tab", socketDir: `/sockets/${conversationId}` }))
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyMobileSessionToken: mocks.verifyMobileSessionToken,
  verifySessionToken: mocks.verifySessionToken
}));

vi.mock("@/lib/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/conversations")>()),
  getConversationOwnerId: mocks.getConversationOwnerId
}));

vi.mock("@/lib/agent-computer-relay", () => ({
  attachComputerViewer: mocks.attachComputerViewer,
  conversationBrowserTarget: mocks.conversationBrowserTarget
}));

class FakeSocket extends EventEmitter {
  readyState = 1;
  close = vi.fn();
  terminate = vi.fn();
}

function upgrade(url: string, headers: Record<string, string>) {
  return { url, headers } as unknown as IncomingMessage;
}

async function connect(req: IncomingMessage, mode: "browser" | "mobile" = "browser") {
  const { setupComputerWebSocketHandler } = await import("@/lib/ws-handler");
  const wss = new EventEmitter();
  setupComputerWebSocketHandler(wss as unknown as WebSocketServer, { authModeForRequest: () => mode });
  const socket = new FakeSocket();
  wss.emit("connection", socket, req);
  await vi.waitFor(() => expect(socket.close.mock.calls.length + mocks.attachComputerViewer.mock.calls.length).toBeGreaterThan(0));
  return socket;
}

describe("computer WebSocket", () => {
  beforeEach(() => {
    for (const mock of [mocks.verifySessionToken, mocks.verifyMobileSessionToken, mocks.getCurrentUser, mocks.getConversationOwnerId, mocks.attachComputerViewer]) {
      mock.mockReset();
    }
    mocks.verifySessionToken.mockResolvedValue({ sessionId: "s1", userId: "user_1" });
    mocks.verifyMobileSessionToken.mockResolvedValue({ sessionId: "m1", userId: "user_1" });
    mocks.getConversationOwnerId.mockReturnValue("user_1");
  });

  it("attaches the owner's browser tab for a same-origin web viewer", async () => {
    const socket = await connect(
      upgrade("/ws/computer?conversationId=conv_1", { host: "eidon.local", origin: "http://eidon.local", cookie: "eidon_session=token" })
    );

    expect(socket.close).not.toHaveBeenCalled();
    expect(mocks.attachComputerViewer).toHaveBeenCalledWith(socket, { ownerKey: "user_1", sessionName: "tab", socketDir: "/sockets/conv_1" }, { mobile: false });
  });

  it("refuses a page on another origin", async () => {
    const socket = await connect(
      upgrade("/ws/computer?conversationId=conv_1", { host: "eidon.local", origin: "https://evil.example", cookie: "eidon_session=token" })
    );

    expect(socket.close).toHaveBeenCalledWith(1008, "Forbidden origin");
    expect(mocks.attachComputerViewer).not.toHaveBeenCalled();
  });

  it("refuses viewers who are not signed in or do not own the conversation", async () => {
    mocks.verifySessionToken.mockResolvedValue(null);
    const anonymous = await connect(upgrade("/ws/computer?conversationId=conv_1", { host: "eidon.local", cookie: "eidon_session=bad" }));
    expect(anonymous.close).toHaveBeenCalledWith(1008, "Authentication required");

    mocks.verifySessionToken.mockResolvedValue({ sessionId: "s1", userId: "user_1" });
    mocks.getConversationOwnerId.mockReturnValue("user_2");
    const stranger = await connect(upgrade("/ws/computer?conversationId=conv_1", { host: "eidon.local", cookie: "eidon_session=token" }));
    expect(stranger.close).toHaveBeenCalledWith(1008, "Conversation not found");

    const missing = await connect(upgrade("/ws/computer", { host: "eidon.local", cookie: "eidon_session=token" }));
    expect(missing.close).toHaveBeenCalledWith(1008, "Conversation not found");
    expect(mocks.attachComputerViewer).not.toHaveBeenCalled();
  });

  it("authenticates mobile viewers with their bearer token at a lower frame rate", async () => {
    const socket = await connect(
      upgrade("/api/v1/ws/computer?conversationId=conv_1", { host: "eidon.local", authorization: "Bearer mobile-token" }),
      "mobile"
    );

    expect(mocks.verifyMobileSessionToken).toHaveBeenCalledWith("mobile-token");
    expect(mocks.attachComputerViewer).toHaveBeenCalledWith(socket, expect.anything(), { mobile: true });
  });

  it("refuses mobile viewers over plain HTTP in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const socket = await connect(
        upgrade("/api/v1/ws/computer?conversationId=conv_1", { host: "eidon.local", authorization: "Bearer mobile-token", "x-forwarded-proto": "http" }),
        "mobile"
      );
      expect(socket.close).toHaveBeenCalledWith(1008, "Forbidden origin");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
