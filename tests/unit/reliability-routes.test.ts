import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBot, ensureChiefBot, getBot } from "@/lib/bots";
import { createConversation, getConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();

  return {
    ...actual,
    requireUser: requireUserMock
  };
});

describe("reliability route hardening", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("returns a client error for malformed multipart attachment uploads", async () => {
    const user = await createLocalUser({
      username: "malformed-upload-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { "content-type": "multipart/form-data" },
        body: "not a multipart body"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid attachment upload (unparseable multipart body)"
    });
  });

  it("rejects attachment batches larger than the declared native limit", async () => {
    const user = await createLocalUser({
      username: "oversized-upload-batch-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Attachment batch", null, undefined, user.id);
    requireUserMock.mockResolvedValue(user);
    const formData = new FormData();
    formData.set("conversationId", conversation.id);
    for (let index = 0; index < 101; index += 1) {
      formData.append("files", new File(["x"], `file-${index}.txt`, { type: "text/plain" }));
    }

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(new Request("http://localhost/api/attachments", {
      method: "POST",
      body: formData
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A maximum of 100 files may be uploaded at once"
    });
  });

  it("returns a client error when env-managed account credentials are updated", async () => {
    const auth = await import("@/lib/auth");
    await auth.ensureAdminBootstrap();
    const admin = await auth.findUserByUsername("admin");
    requireUserMock.mockResolvedValue(admin!.user);

    const { PUT } = await import("@/app/api/auth/account/route");
    const response = await PUT(
      new Request("http://localhost/api/auth/account", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "admin-renamed",
          password: "new-secret-123",
          currentPassword: "changeme123"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Env-managed credentials cannot be changed in the UI"
    });
  });

  it("returns not found when deleting a missing conversation id", async () => {
    const user = await createLocalUser({
      username: "delete-missing-conversation-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await DELETE(
      new Request("http://localhost/api/conversations/conv_missing", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ conversationId: "conv_missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Conversation not found"
    });
  });

  it("still reports success when deleting an existing conversation", async () => {
    const user = await createLocalUser({
      username: "delete-existing-conversation-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Delete me", null, undefined, user.id);
    requireUserMock.mockResolvedValue(user);

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/conversations/${conversation.id}`, {
        method: "DELETE"
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      deleted: true
    });
  });

  it("preserves onlyIfEmpty delete semantics for nonempty conversations", async () => {
    const user = await createLocalUser({
      username: "delete-nonempty-conversation-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Keep me", null, undefined, user.id);
    requireUserMock.mockResolvedValue(user);

    const { createMessage } = await import("@/lib/conversations");
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Do not delete this populated conversation"
    });

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/conversations/${conversation.id}?onlyIfEmpty=1`, {
        method: "DELETE"
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      deleted: false
    });
  });

  it("refuses to delete a bot's home conversation and keeps the bot", async () => {
    const user = await createLocalUser({
      username: "delete-bot-thread-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    for (const bot of [ensureChiefBot(user.id), createBot({ name: "Protected" }, user.id)]) {
      for (const query of ["", "?onlyIfEmpty=1"]) {
        const response = await DELETE(
          new Request(`http://localhost/api/conversations/${bot.homeConversationId}${query}`, {
            method: "DELETE"
          }),
          { params: Promise.resolve({ conversationId: bot.homeConversationId }) }
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
          error: "A bot's conversation can't be deleted on its own"
        });
      }
      expect(getBot(bot.id, user.id)?.homeConversationId).toBe(bot.homeConversationId);
    }
  });

  it("refuses to make a bot's home conversation temporary", async () => {
    const user = await createLocalUser({
      username: "temporary-bot-thread-user",
      password: "Password123!",
      role: "user"
    });
    const bot = createBot({ name: "Persistent" }, user.id);
    requireUserMock.mockResolvedValue(user);

    const { PATCH } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await PATCH(
      new Request(`http://localhost/api/conversations/${bot.homeConversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTemporary: true })
      }),
      { params: Promise.resolve({ conversationId: bot.homeConversationId }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Only regular chats can be made temporary"
    });
    expect(getConversation(bot.homeConversationId, user.id)?.isTemporary).toBe(false);
  });
});

describe("attachment upload robustness", () => {
  const boundary = "----WebKitFormBoundaryTest123";
  let uploadUser: Awaited<ReturnType<typeof createLocalUser>>;

  function buildMultipartBody(
    parts: Array<{ name: string; content: string; filename?: string; dispositionExtra?: string; type?: string }>
  ) {
    let body = "";
    for (const part of parts) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="${part.name}"${
        part.filename !== undefined ? `; filename="${part.filename}"` : ""
      }${part.dispositionExtra ?? ""}\r\n`;
      if (part.type) body += `Content-Type: ${part.type}\r\n`;
      body += `\r\n${part.content}\r\n`;
    }
    body += `--${boundary}--\r\n`;
    return body;
  }

  function uploadRequest(body: BodyInit, extraInit?: RequestInit) {
    return new Request("http://localhost/api/attachments", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      ...extraInit
    } as RequestInit);
  }

  beforeEach(async () => {
    uploadUser = await createLocalUser({
      username: `upload-robustness-${Math.random().toString(36).slice(2, 8)}`,
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(uploadUser);
  });

  it("accepts iOS-style uploads with UTF-8, duplicate, and parenthesized filenames", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const conversation = createConversation("iOS uploads", null, undefined, uploadUser.id);
    const body = buildMultipartBody([
      { name: "conversationId", content: conversation.id },
      { name: "files", content: "jpeg-bytes-1", filename: "IMG_0001 äöü 照片.jpg", type: "image/jpeg" },
      { name: "files", content: "jpeg-bytes-2", filename: "photo (1).jpg", type: "image/jpeg" },
      { name: "files", content: "jpeg-bytes-3", filename: "photo (1).jpg", type: "image/jpeg" },
      { name: "files", content: "jpeg-bytes-4", filename: "IMG_0002.JPG" }
    ]);

    const response = await POST(uploadRequest(body));

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { attachments: Array<{ filename: string }> };
    expect(payload.attachments).toHaveLength(4);
    expect(payload.attachments.map((attachment) => attachment.filename)).toEqual([
      "IMG_0001_.jpg",
      "photo_1_.jpg",
      "photo_1_.jpg",
      "IMG_0002.JPG"
    ]);
  });

  it("accepts RFC 5987 filename* disposition parameters and extra disposition params", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const conversation = createConversation("Filename star", null, undefined, uploadUser.id);
    const body = buildMultipartBody([
      { name: "conversationId", content: conversation.id },
      {
        name: "files",
        content: "jpeg-bytes",
        filename: "photo.jpg",
        dispositionExtra: "; filename*=UTF-8''%E7%85%A7%E7%89%87.jpg",
        type: "image/jpeg"
      },
      {
        name: "files",
        content: "jpeg-bytes",
        filename: "extra.jpg",
        dispositionExtra: "; foo=\"bar\"; x-custom=1",
        type: "image/jpeg"
      },
      {
        name: "files",
        content: "jpeg-bytes",
        filename: "",
        type: "image/jpeg"
      }
    ]);

    const response = await POST(uploadRequest(body));

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { attachments: Array<{ filename: string }> };
    expect(payload.attachments).toHaveLength(3);
    expect(payload.attachments[0]!.filename).toBe("_.jpg");
    expect(payload.attachments[1]!.filename).toBe("extra.jpg");
    expect(payload.attachments[2]!.filename).toBe("attachment");
  });

  it("reports missing conversationId distinctly", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const body = buildMultipartBody([
      { name: "files", content: "jpeg-bytes", filename: "a.jpg", type: "image/jpeg" }
    ]);

    const response = await POST(uploadRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid attachment upload (missing conversationId)"
    });
  });

  it("reports truncated multipart bodies distinctly", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const conversation = createConversation("Truncated upload", null, undefined, uploadUser.id);
    const fullBody = buildMultipartBody([
      { name: "conversationId", content: conversation.id },
      { name: "files", content: "jpeg-bytes-that-are-cut-off", filename: "a.jpg", type: "image/jpeg" }
    ]);
    const truncated = Buffer.from(fullBody.slice(0, fullBody.length - 40), "utf8");

    const response = await POST(uploadRequest(truncated));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid attachment upload (unparseable multipart body)"
    });
  });

  it("reports interrupted upload streams as retryable", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const partial = buildMultipartBody([
      { name: "conversationId", content: "conv_interrupted" },
      { name: "files", content: "jpeg-bytes", filename: "a.jpg", type: "image/jpeg" }
    ]);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(partial.slice(0, 60)));
        controller.error(new Error("client disconnected"));
      }
    });

    const response = await POST(uploadRequest(body, { duplex: "half" } as RequestInit));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Upload interrupted before completion — retry"
    });
  });
});
