import { describe, expect, it } from "vitest";

import { createConversation, createMessage, enableConversationShare } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

describe("public shared conversation route", () => {
  it("returns a shared read-only snapshot without requiring auth", async () => {
    const user = await createLocalUser({
      username: "public-share-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Public route", null, {}, user.id);
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Public answer"
    });
    const share = enableConversationShare(conversation.id, user.id);
    expect(share).not.toBeNull();

    const { GET } = await import("@/app/api/share/[shareToken]/route");
    const response = await GET(new Request(`http://localhost/api/share/${share!.token}`), {
      params: Promise.resolve({ shareToken: share!.token })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversation: expect.objectContaining({
        id: conversation.id,
        title: "Public route",
        shareEnabled: true,
        shareToken: share!.token
      }),
      messages: [
        expect.objectContaining({
          role: "assistant",
          content: "Public answer",
          attachments: []
        })
      ],
      queuedMessages: []
    });
  });

  it("returns not found for disabled or malformed share tokens", async () => {
    const user = await createLocalUser({
      username: "public-share-disabled-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Disabled public route", null, {}, user.id);
    const share = enableConversationShare(conversation.id, user.id);
    expect(share).not.toBeNull();

    const { disableConversationShare } = await import("@/lib/conversations");
    disableConversationShare(conversation.id, user.id);

    const { GET } = await import("@/app/api/share/[shareToken]/route");
    const disabled = await GET(new Request(`http://localhost/api/share/${share!.token}`), {
      params: Promise.resolve({ shareToken: share!.token })
    });
    expect(disabled.status).toBe(404);

    const malformed = await GET(new Request("http://localhost/api/share/short"), {
      params: Promise.resolve({ shareToken: "short" })
    });
    expect(malformed.status).toBe(404);
  });
});
