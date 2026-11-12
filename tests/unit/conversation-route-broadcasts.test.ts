import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("conversation route broadcasts", () => {
  let userEvents: Array<{ event: Record<string, unknown>; userId?: string | null }>;

  beforeEach(async () => {
    requireUserMock.mockReset();
    userEvents = [];
    const { getConversationManager } = await import("@/lib/ws-singleton");
    vi.spyOn(getConversationManager(), "broadcastAll").mockImplementation((event, userId) => {
      userEvents.push({ event: event as Record<string, unknown>, userId });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function signIn() {
    const user = await createLocalUser({ username: `route-broadcast-${Date.now()}-${Math.random()}`, password: "Password123!", role: "user" });
    requireUserMock.mockResolvedValue(user);
    return user;
  }

  it("publishes conversation_created from the create route through the bus", async () => {
    const user = await signIn();
    const { POST } = await import("@/app/api/conversations/route");

    const response = await POST(
      new Request("http://localhost/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Broadcast check" })
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { conversation: { id: string } };
    expect(userEvents).toEqual([
      {
        event: {
          type: "conversation_created",
          conversation: {
            id: body.conversation.id,
            title: "Broadcast check",
            folderId: null,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
            isActive: false,
            isTemporary: false
          }
        },
        userId: user.id
      }
    ]);
  });

  it("publishes title_updated and conversation_updated from the patch route", async () => {
    const user = await signIn();
    const conversation = createConversation("Before", null, undefined, user.id);
    const { PATCH } = await import("@/app/api/conversations/[conversationId]/route");

    const response = await PATCH(
      new Request(`http://localhost/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "After" })
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(200);
    expect(userEvents.map(({ event }) => event.type)).toEqual([
      "conversation_title_updated",
      "conversation_updated"
    ]);
    expect(userEvents[0].event).toEqual({
      type: "conversation_title_updated",
      conversationId: conversation.id,
      title: "After"
    });
    expect(userEvents[1].event).toEqual({
      type: "conversation_updated",
      conversation: {
        id: conversation.id,
        title: "After",
        folderId: null,
        updatedAt: expect.any(String),
        isActive: false
      }
    });
  });

  it("publishes conversation_deleted from the delete route", async () => {
    const user = await signIn();
    const conversation = createConversation("Doomed", null, undefined, user.id);
    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");

    const response = await DELETE(
      new Request(`http://localhost/api/conversations/${conversation.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(200);
    expect(userEvents).toEqual([
      {
        event: { type: "conversation_deleted", conversationId: conversation.id },
        userId: user.id
      }
    ]);
  });

  it("publishes conversation_created from inside the fork mutation after commit", async () => {
    const user = await signIn();
    const { createMessage } = await import("@/lib/conversations");
    const conversation = createConversation("Fork me", null, undefined, user.id);
    const message = createMessage({ conversationId: conversation.id, role: "user", content: "Hello" });

    const { POST } = await import("@/app/api/messages/[messageId]/fork/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/fork`, { method: "POST" }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { conversation: { id: string } };
    expect(userEvents).toEqual([
      {
        event: {
          type: "conversation_created",
          conversation: {
            id: body.conversation.id,
            title: `Fork ${conversation.title}`,
            folderId: null,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
            isActive: false,
            isTemporary: false
          }
        },
        userId: user.id
      }
    ]);
  });
});
