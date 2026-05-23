import { createConversation, getConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("PATCH /api/conversations/[conversationId] — rename", () => {
  let userId: string;

  beforeEach(async () => {
    const db = getDb();
    db.exec("DELETE FROM conversations");
    db.exec("DELETE FROM users");
    const user = await createLocalUser({
      username: "rename-test@example.com",
      password: "Password123!",
      role: "user"
    });
    userId = user.id;
    requireUserMock.mockResolvedValue({ id: userId });
  });

  it("renames a conversation via PATCH with title", async () => {
    const conversation = createConversation(null, null, undefined, userId);
    requireUserMock.mockResolvedValue({ id: userId });

    const { PATCH } = await import(
      "@/app/api/conversations/[conversationId]/route"
    );

    const request = new Request(
      "http://localhost/api/conversations/" + conversation.id,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed Title" })
      }
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ conversationId: conversation.id })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.conversation.title).toBe("Renamed Title");

    const updated = getConversation(conversation.id, userId);
    expect(updated?.title).toBe("Renamed Title");
    expect(updated?.titleGenerationStatus).toBe("completed");
  });

  it("rejects empty title", async () => {
    const conversation = createConversation(null, null, undefined, userId);
    requireUserMock.mockResolvedValue({ id: userId });

    const { PATCH } = await import(
      "@/app/api/conversations/[conversationId]/route"
    );

    const request = new Request(
      "http://localhost/api/conversations/" + conversation.id,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" })
      }
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ conversationId: conversation.id })
    });

    expect(response.status).toBe(400);
  });
});
