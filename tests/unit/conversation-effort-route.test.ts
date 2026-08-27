import { createConversation, getConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("conversation reasoning effort routes", () => {
  let userId: string;

  beforeEach(async () => {
    const db = getDb();
    db.exec("DELETE FROM conversations");
    db.exec("DELETE FROM users");
    const user = await createLocalUser({
      username: "effort-test@example.com",
      password: "Password123!",
      role: "user"
    });
    userId = user.id;
    requireUserMock.mockResolvedValue({ id: userId });
  });

  it("sets and clears the conversation reasoning effort via PATCH", async () => {
    const conversation = createConversation(null, null, undefined, userId);

    const { PATCH } = await import(
      "@/app/api/conversations/[conversationId]/route"
    );

    const setRequest = new Request(
      "http://localhost/api/conversations/" + conversation.id,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasoningEffort: "xhigh" })
      }
    );

    const setResponse = await PATCH(setRequest, {
      params: Promise.resolve({ conversationId: conversation.id })
    });

    expect(setResponse.status).toBe(200);
    const setBody = await setResponse.json();
    expect(setBody.conversation.reasoningEffort).toBe("xhigh");
    expect(getConversation(conversation.id, userId)?.reasoningEffort).toBe("xhigh");

    const clearRequest = new Request(
      "http://localhost/api/conversations/" + conversation.id,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasoningEffort: null })
      }
    );

    const clearResponse = await PATCH(clearRequest, {
      params: Promise.resolve({ conversationId: conversation.id })
    });

    expect(clearResponse.status).toBe(200);
    const clearBody = await clearResponse.json();
    expect(clearBody.conversation.reasoningEffort).toBeNull();
    expect(getConversation(conversation.id, userId)?.reasoningEffort).toBeNull();
  });

  it("rejects invalid reasoning effort values via PATCH", async () => {
    const conversation = createConversation(null, null, undefined, userId);

    const { PATCH } = await import(
      "@/app/api/conversations/[conversationId]/route"
    );

    const request = new Request(
      "http://localhost/api/conversations/" + conversation.id,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasoningEffort: "turbo" })
      }
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ conversationId: conversation.id })
    });

    expect(response.status).toBe(400);
    expect(getConversation(conversation.id, userId)?.reasoningEffort).toBeNull();
  });

  it("creates a conversation with an initial reasoning effort via POST", async () => {
    const { POST } = await import("@/app/api/conversations/route");

    const request = new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reasoningEffort: "low" })
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.conversation.reasoningEffort).toBe("low");
    expect(getConversation(body.conversation.id, userId)?.reasoningEffort).toBe("low");
  });
});
