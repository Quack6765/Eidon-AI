import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBot } from "@/lib/bots";
import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock, redirectMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  })
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: requireUserMock
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: redirectMock
}));

vi.mock("@/components/shell", () => ({ Shell: () => null }));
vi.mock("@/components/chat-view", () => ({ ChatView: () => null }));

async function renderPage(conversationId: string) {
  const { default: ConversationPage } = await import("@/app/chat/[conversationId]/page");
  return ConversationPage({ params: Promise.resolve({ conversationId }) });
}

describe("conversation page", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    redirectMock.mockClear();
  });

  it("sends a bot's home thread to its bot page", async () => {
    const user = await createLocalUser({ username: "chat-page-bot-owner", password: "Password123!", role: "user" });
    requireUserMock.mockResolvedValue(user);
    const bot = createBot({ name: "Router" }, user.id);

    await expect(renderPage(bot.homeConversationId)).rejects.toThrow(`NEXT_REDIRECT /agents/${bot.id}`);
  });

  it("renders a regular chat in place", async () => {
    const user = await createLocalUser({ username: "chat-page-owner", password: "Password123!", role: "user" });
    requireUserMock.mockResolvedValue(user);
    const conversation = createConversation("Regular", null, undefined, user.id);

    await expect(renderPage(conversation.id)).resolves.toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
