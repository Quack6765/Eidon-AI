import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

import { POST as dismiss } from "@/app/api/message-actions/[actionId]/dismiss/route";
import { POST as fillSecret } from "@/app/api/message-actions/[actionId]/secret/route";
import { DELETE as deleteLogin } from "@/app/api/saved-logins/[loginId]/route";
import { GET as listLogins } from "@/app/api/saved-logins/route";
import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { saveLogin } from "@/lib/saved-logins";
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

describe("secret and saved-login routes", () => {
  beforeEach(() => requireUserMock.mockReset());

  it("rejects empty or oversized secrets and unknown requests without echoing the value", async () => {
    const { user, action } = await pendingSecretRequest("secret-route-owner");
    requireUserMock.mockResolvedValue(user);

    expect((await fillSecret(post({ value: "" }), actionContext(action.id))).status).toBe(400);
    expect((await fillSecret(post({ value: "x".repeat(1_001) }), actionContext(action.id))).status).toBe(400);
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
  });

  it("lists saved logins without values and deletes only the user's own", async () => {
    const owner = await createLocalUser({ username: "logins-route-owner", password: "Password123!", role: "user" });
    const other = await createLocalUser({ username: "logins-route-other", password: "Password123!", role: "user" });
    saveLogin(owner.id, "https://example.com", "password", "never-shown-value");

    requireUserMock.mockResolvedValue(owner);
    const listed = await listLogins();
    const text = await listed.text();
    expect(text).not.toContain("never-shown-value");
    const id = (JSON.parse(text) as { savedLogins: Array<{ id: string }> }).savedLogins[0].id;

    requireUserMock.mockResolvedValue(other);
    expect((await deleteLogin(new Request("http://localhost"), { params: Promise.resolve({ loginId: id }) })).status).toBe(404);
    requireUserMock.mockResolvedValue(owner);
    expect((await deleteLogin(new Request("http://localhost"), { params: Promise.resolve({ loginId: id }) })).status).toBe(200);
  });
});
