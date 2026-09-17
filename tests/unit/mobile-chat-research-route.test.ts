import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as mobilePost } from "@/app/api/v1/[...path]/route";
import { createMobileSession } from "@/lib/auth";
import { MAX_RESEARCH_PLAN_STEPS, MAX_RESEARCH_PLAN_STEP_CHARS } from "@/lib/constants";
import { createConversation } from "@/lib/conversations";
import type { ChatStreamEvent } from "@/lib/types";
import { createLocalUser } from "@/lib/users";
import { assertOpenApiRequestBody } from "@/tests/fixtures/mobile-contract-validator";

const runAssistantTurnMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/chat-turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-turn")>()),
  runAssistantTurn: runAssistantTurnMock
}));

const chatPathname = "/conversations/{conversationId}/chat";

async function setupConversation() {
  const user = await createLocalUser({
    username: "mobile-research",
    password: "MobileResearchPassword123!",
    role: "user"
  });
  const session = await createMobileSession(user.id, "Research phone");
  const conversation = createConversation("Research", null, {}, user.id);
  return { token: session.token, conversationId: conversation.id };
}

function postChat(token: string, conversationId: string, body: unknown) {
  const path = ["conversations", conversationId, "chat"];
  return mobilePost(
    new Request(`http://localhost/api/v1/${path.join("/")}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ path }) }
  );
}

describe("Mobile API v1 deep research chat turns", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    runAssistantTurnMock.mockReset();
    runAssistantTurnMock.mockImplementation(async function* () {
      yield { type: "done", messageId: "msg_research" } satisfies ChatStreamEvent;
    });
  });

  it("forwards an explicit research plan from the mobile chat request into the turn", async () => {
    const { token, conversationId } = await setupConversation();
    const body = {
      message: "Compare the two approaches",
      research: { plan: ["Survey the primary sources", "Contrast the trade-offs"] }
    };
    expect(() => assertOpenApiRequestBody(chatPathname, "post", body)).not.toThrow();

    const response = await postChat(token, conversationId, body);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toContain('"type":"done"');
    expect(runAssistantTurnMock).toHaveBeenCalledTimes(1);
    expect(runAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      content: body.message,
      attachmentIds: [],
      research: { plan: ["Survey the primary sources", "Contrast the trade-offs"] }
    }));
  });

  it("starts a research turn with a server-generated plan when research is an empty object", async () => {
    const { token, conversationId } = await setupConversation();
    const body = { message: "Investigate the incident", research: {} };
    expect(() => assertOpenApiRequestBody(chatPathname, "post", body)).not.toThrow();

    const response = await postChat(token, conversationId, body);
    expect(response.status).toBe(200);
    await response.text();
    expect(runAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      research: {}
    }));
  });

  it("leaves research undefined for a normal turn", async () => {
    const { token, conversationId } = await setupConversation();
    const response = await postChat(token, conversationId, { message: "Hello" });
    expect(response.status).toBe(200);
    await response.text();
    expect(runAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({ research: undefined }));
  });

  it("rejects malformed research payloads with the v1 error envelope without starting a turn", async () => {
    const { token, conversationId } = await setupConversation();
    const cases: Array<{ research: unknown; message: string }> = [
      { research: true, message: "Invalid chat payload" },
      { research: { deadlineMs: 1000 }, message: "Invalid chat payload" },
      { research: { plan: [] }, message: "Invalid chat payload" },
      { research: { plan: ["   "] }, message: "Invalid chat payload" },
      {
        research: { plan: Array.from({ length: MAX_RESEARCH_PLAN_STEPS + 1 }, () => "Step") },
        message: `Array must contain at most ${MAX_RESEARCH_PLAN_STEPS} element(s)`
      },
      {
        research: { plan: ["x".repeat(MAX_RESEARCH_PLAN_STEP_CHARS + 1)] },
        message: `String must contain at most ${MAX_RESEARCH_PLAN_STEP_CHARS} character(s)`
      }
    ];

    for (const { research, message } of cases) {
      const body = { message: "Look into this", research };
      expect(() => assertOpenApiRequestBody(chatPathname, "post", body)).toThrow(
        /request body failed contract validation/
      );
      const response = await postChat(token, conversationId, body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_request", message }
      });
    }
    expect(runAssistantTurnMock).not.toHaveBeenCalled();
  });
});
