import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderProfileInput } from "@/tests/provider-fixtures";

const { requireUserMock, generateResearchPlanMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  generateResearchPlanMock: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: vi.fn(),
  callProviderText: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/mcp-client", () => ({
  gatherAllMcpTools: vi.fn().mockResolvedValue([])
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: vi.fn().mockResolvedValue({
    promptMessages: [],
    compactionNoticeEvent: null
  }),
  getConversationContextUsage: vi.fn().mockReturnValue({
    contextTokens: 512,
    compactionLimit: 8192
  })
}));

vi.mock("@/lib/conversation-title-generator", () => ({
  generateConversationTitle: vi.fn(),
  sanitizeGeneratedConversationTitle: vi.fn(),
  buildConversationTitlePrompt: vi.fn(),
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE: "Files",
  DEFAULT_CONVERSATION_TITLE: "Conversation",
  MAX_CONVERSATION_TITLE_LENGTH: 48
}));

vi.mock("@/lib/research-plan", () => ({
  generateResearchPlan: generateResearchPlanMock
}));

function request(method: string, conversationId: string, body: unknown) {
  return new Request(`http://localhost/api/conversations/${conversationId}/research`, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("conversation research route", () => {
  beforeEach(async () => {
    vi.resetModules();
    requireUserMock.mockReset();
    generateResearchPlanMock.mockReset();
    generateResearchPlanMock.mockResolvedValue(["Find official pages", "Compare amounts"]);
  });

  async function setup() {
    const { updateProviderCatalog } = await import("@/lib/settings");
    const { createConversation } = await import("@/lib/conversations");
    const { createLocalUser } = await import("@/lib/users");
    const profileId = "profile_research_route";
    updateProviderCatalog({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [
        createProviderProfileInput({
          id: profileId,
          name: "Research",
          model: "gpt-test",
          systemPrompt: "Be exact.",
          temperature: 0.2,
          maxOutputTokens: 512,
          modelContextLimit: 16384,
          freshTailCount: 12
        })
      ]
    });
    const user = await createLocalUser({
      username: `research-route-${Math.random().toString(36).slice(2, 8)}`,
      password: "research-secret-123",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    const conversation = createConversation("Research", null, { providerProfileId: profileId }, user.id);
    const route = await import("@/app/api/conversations/[conversationId]/research/route");
    const context = { params: Promise.resolve({ conversationId: conversation.id }) };
    return { user, conversation, route, context };
  }

  it("persists the question, starts title generation, and returns a drafted plan", async () => {
    const { conversation, route, context } = await setup();
    const { listVisibleMessages } = await import("@/lib/conversations");

    const response = await route.POST(request("POST", conversation.id, { message: "  Research heat pumps  " }), context);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: { id: string; role: string; content: string }; plan: string[] };
    expect(body.message).toMatchObject({ role: "user", content: "Research heat pumps" });
    expect(body.plan).toEqual(["Find official pages", "Compare amounts"]);
    expect(generateResearchPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Research heat pumps", settings: expect.objectContaining({ id: "profile_research_route" }) })
    );
    expect(listVisibleMessages(conversation.id).map((message) => [message.role, message.id])).toEqual([
      ["user", body.message.id]
    ]);
  });

  it("starts the research turn from the pending message and rejects double starts", async () => {
    const { conversation, route, context } = await setup();
    const { streamProviderResponse } = await import("@/lib/provider");
    const { listVisibleMessages } = await import("@/lib/conversations");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(streamProviderResponse).mockReturnValueOnce((async function* () {
      yield { type: "answer_delta", text: "# Report" };
      await gate;
      return { answer: "# Report", thinking: "", usage: { outputTokens: 2 } };
    })());

    const prepared = (await (
      await route.POST(request("POST", conversation.id, { message: "Research heat pumps" }), context)
    ).json()) as { message: { id: string } };

    const started = await route.PUT(
      request("PUT", conversation.id, { userMessageId: prepared.message.id, plan: ["Find pages", "Compare"] }),
      context
    );
    expect(started.status).toBe(200);

    const conflict = await route.PUT(
      request("PUT", conversation.id, { userMessageId: prepared.message.id, plan: ["Again"] }),
      context
    );
    expect(conflict.status).toBe(409);

    release();
    await vi.waitFor(() => {
      const assistant = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("completed");
    });
    const systemPrompt = String(vi.mocked(streamProviderResponse).mock.calls.at(-1)?.[0].promptMessages[0].content);
    expect(systemPrompt).toContain("Deep research mode is active");
    expect(systemPrompt).toContain("1. Find pages\n2. Compare");
    const assistant = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
    expect(assistant?.actions).toEqual([expect.objectContaining({ kind: "research_plan", status: "completed" })]);
  });

  it("cancels by deleting the pending question only while it is the latest message", async () => {
    const { conversation, route, context } = await setup();
    const { listVisibleMessages } = await import("@/lib/conversations");

    const prepared = (await (
      await route.POST(request("POST", conversation.id, { message: "Research heat pumps" }), context)
    ).json()) as { message: { id: string } };

    const cancelled = await route.DELETE(request("DELETE", conversation.id, { userMessageId: prepared.message.id }), context);
    expect(cancelled.status).toBe(200);
    expect(listVisibleMessages(conversation.id)).toEqual([]);

    const missing = await route.DELETE(request("DELETE", conversation.id, { userMessageId: prepared.message.id }), context);
    expect(missing.status).toBe(404);
  });

  it("validates auth, ownership, payloads, and message ownership", async () => {
    const { conversation, route, context } = await setup();
    const { createConversation } = await import("@/lib/conversations");
    const { createLocalUser } = await import("@/lib/users");

    expect((await route.POST(request("POST", conversation.id, { message: "   " }), context)).status).toBe(400);
    expect((await route.POST(request("POST", conversation.id, "{not json"), context)).status).toBe(400);
    expect((await route.PUT(request("PUT", conversation.id, { userMessageId: "missing", plan: ["x"] }), context)).status).toBe(404);
    expect((await route.PUT(request("PUT", conversation.id, { userMessageId: "m", plan: [] }), context)).status).toBe(400);
    expect((await route.DELETE(request("DELETE", conversation.id, {}), context)).status).toBe(400);

    const other = await createLocalUser({
      username: `research-other-${Math.random().toString(36).slice(2, 8)}`,
      password: "research-secret-123",
      role: "user"
    });
    const foreign = createConversation("Foreign", null, { providerProfileId: "profile_research_route" }, other.id);
    expect(
      (await route.POST(request("POST", foreign.id, { message: "hello" }), { params: Promise.resolve({ conversationId: foreign.id }) })).status
    ).toBe(404);

    requireUserMock.mockResolvedValue(null);
    expect((await route.POST(request("POST", conversation.id, { message: "hello" }), context)).status).toBe(401);
  });
});
