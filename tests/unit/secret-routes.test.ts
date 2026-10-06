import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

import { POST as dismiss } from "@/app/api/message-actions/[actionId]/dismiss/route";
import { POST as fillSecret } from "@/app/api/message-actions/[actionId]/secret/route";
import { MAX_SECRET_CHARS } from "@/lib/constants";
import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

function actionContext(actionId: string) {
  return { params: Promise.resolve({ actionId }) };
}

function post(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function pendingSecretRequest(username: string) {
  const user = await createLocalUser({ username, password: "Password123!", role: "user" });
  const conversation = createConversation(undefined, undefined, undefined, user.id);
  const message = createMessage({ conversationId: conversation.id, role: "assistant", content: "", status: "streaming" });
  const action = createMessageAction({
    messageId: message.id,
    kind: "secret_request",
    status: "pending",
    label: "Enter your password",
    detail: "https://example.com",
    proposalState: "pending",
    proposalPayload: { operation: "secret_request", label: "password", origin: "https://example.com", target: "@e5", save: false }
  });
  return { user, action };
}

describe("secret request routes", () => {
  beforeEach(() => requireUserMock.mockReset());

  it("rejects empty or oversized secrets and unknown requests without echoing the value", async () => {
    const { user, action } = await pendingSecretRequest("secret-route-owner");
    requireUserMock.mockResolvedValue(user);

    expect((await fillSecret(post({ value: "" }), actionContext(action.id))).status).toBe(400);
    expect((await fillSecret(post({ value: "x".repeat(MAX_SECRET_CHARS + 1) }), actionContext(action.id))).status).toBe(400);
    expect((await fillSecret(post("not json"), actionContext(action.id))).status).toBe(400);

    const missing = await fillSecret(post({ value: "hunter22" }), actionContext("act_missing"));
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("hunter22");
  });

  it("declines a secret request through the dismiss route", async () => {
    const { user, action } = await pendingSecretRequest("secret-route-decline");
    requireUserMock.mockResolvedValue(user);

    const response = await dismiss(post({}), actionContext(action.id));
    const body = (await response.json()) as { action: { resultSummary: string; proposalPayload: { resolution: string } } };

    expect(response.status).toBe(200);
    expect(body.action.resultSummary).toBe("You declined");
    expect(body.action.proposalPayload.resolution).toBe("declined");

    const stranger = await createLocalUser({ username: "secret-route-stranger", password: "Password123!", role: "user" });
    const other = await pendingSecretRequest("secret-route-victim");
    requireUserMock.mockResolvedValue(stranger);
    expect((await dismiss(post({}), actionContext(other.action.id))).status).toBe(404);
  });
});
