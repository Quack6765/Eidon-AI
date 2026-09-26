import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

import { GET } from "@/app/api/conversations/[conversationId]/computer/route";
import { POST } from "@/app/api/conversations/[conversationId]/computer/control/route";
import { resetAgentComputerRelayForTests } from "@/lib/agent-computer-relay";
import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

function params(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}

function control(conversationId: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/conversations/${conversationId}/computer/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    }),
    params(conversationId)
  );
}

describe("computer routes", () => {
  beforeEach(() => {
    resetAgentComputerRelayForTests();
    requireUserMock.mockReset();
  });

  it("reports the browser state and lets the owner take and return control", async () => {
    const owner = await createLocalUser({ username: "computer-route-owner", password: "Password123!", role: "user" });
    const conversation = createConversation(undefined, undefined, undefined, owner.id);
    requireUserMock.mockResolvedValue(owner);

    const state = await GET(new Request("http://localhost"), params(conversation.id));
    expect(await state.json()).toEqual({
      computer: { live: false, controlOwner: "bot", url: null, caption: null, viewport: null }
    });

    const taken = await control(conversation.id, { action: "take" });
    expect(taken.status).toBe(200);
    expect((await taken.json()).computer.controlOwner).toBe("user");

    const returned = await control(conversation.id, { action: "return", note: "Done" });
    expect((await returned.json()).computer.controlOwner).toBe("bot");
  });

  it("rejects other users' conversations and malformed requests", async () => {
    const owner = await createLocalUser({ username: "computer-route-a", password: "Password123!", role: "user" });
    const stranger = await createLocalUser({ username: "computer-route-b", password: "Password123!", role: "user" });
    const conversation = createConversation(undefined, undefined, undefined, owner.id);

    requireUserMock.mockResolvedValue(stranger);
    expect((await control(conversation.id, { action: "take" })).status).toBe(404);
    expect((await GET(new Request("http://localhost"), params(conversation.id))).status).toBe(404);

    requireUserMock.mockResolvedValue(owner);
    expect((await control(conversation.id, { action: "steal" })).status).toBe(400);
    expect((await control(conversation.id, "not json")).status).toBe(400);
    expect((await control(conversation.id, { action: "return", note: "x".repeat(1_001) })).status).toBe(400);
  });
});
