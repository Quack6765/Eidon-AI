import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as deleteMobileRoute,
  GET as getMobileRoute,
  POST as postMobileRoute
} from "@/app/api/v1/[...path]/route";
import { createMobileSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getProviderReadinessError } from "@/lib/provider-adapters";
import {
  createChatgptProviderConnectionFlow,
  pollChatgptProviderConnectionFlow
} from "@/lib/provider-adapters/chatgpt-provider-connection";
import { getProviderConnectionFlow } from "@/lib/provider-connection-flows";
import { claimProviderConnectionAttempt, getRuntimeProviderProfile } from "@/lib/provider-profiles";
import { updateProviderCatalog } from "@/lib/settings";
import { createLocalUser, ensureEnvSuperAdminUser } from "@/lib/users";
import { assertOpenApiResponse } from "@/tests/fixtures/mobile-contract-validator";
import { createProviderCatalogInput, createProviderProfileInput } from "@/tests/provider-fixtures";

const PROFILE_ID = "profile_chatgpt";

function fakeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

const accessToken = fakeJwt({
  "https://api.openai.com/auth": { chatgpt_account_id: "acct_1", chatgpt_plan_type: "pro" },
  "https://api.openai.com/profile": { email: "owner@example.com" }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function seedChatgptProfile() {
  updateProviderCatalog(createProviderCatalogInput([
    createProviderProfileInput({
      id: PROFILE_ID,
      name: "ChatGPT",
      providerKind: "chatgpt_subscription",
      providerConfig: {},
      model: "gpt-6-luna",
      credentials: {}
    })
  ]));
}

function makePollDue(flowId: string) {
  getDb()
    .prepare("UPDATE provider_connection_flows SET state_json = json_set(state_json, '$.nextPollAt', 0) WHERE id = ?")
    .run(flowId);
}

async function adminUser() {
  const admin = await ensureEnvSuperAdminUser();
  return { ...admin, passwordManagedBy: "env" as const };
}

describe("ChatGPT device code connection", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    seedChatgptProfile();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "device_secret", user_code: "ABCD-1234", interval: "5" });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts a device code flow without storing the device secret in plain text", async () => {
    const admin = await adminUser();
    const flow = await createChatgptProviderConnectionFlow(admin, PROFILE_ID);

    expect(flow).toMatchObject({
      authorizationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234"
    });
    expect(Date.parse(flow.expiresAt) - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    const row = getDb()
      .prepare("SELECT state_json, provider_kind FROM provider_connection_flows WHERE id = ?")
      .get(flow.flowId) as { state_json: string; provider_kind: string };
    expect(row.provider_kind).toBe("chatgpt_subscription");
    expect(row.state_json).not.toContain("device_secret");
  });

  it("rejects non-admins and profiles of another kind", async () => {
    const member = await createLocalUser({
      username: "chatgpt-member",
      password: "ChatgptMember123!",
      role: "user"
    });
    await expect(createChatgptProviderConnectionFlow({ ...member, passwordManagedBy: "local" }, PROFILE_ID))
      .rejects.toThrow("Only administrators");
    await expect(createChatgptProviderConnectionFlow(await adminUser(), "missing"))
      .rejects.toThrow("not found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls at most once per interval and stays pending until the user approves", async () => {
    const admin = await adminUser();
    const flow = await createChatgptProviderConnectionFlow(admin, PROFILE_ID);
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));

    await pollChatgptProviderConnectionFlow(flow.flowId, admin.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    makePollDue(flow.flowId);
    await Promise.all([
      pollChatgptProviderConnectionFlow(flow.flowId, admin.id),
      pollChatgptProviderConnectionFlow(flow.flowId, admin.id)
    ]);
    await pollChatgptProviderConnectionFlow(flow.flowId, admin.id);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({
      device_auth_id: "device_secret",
      user_code: "ABCD-1234"
    });
    expect(getProviderConnectionFlow(flow.flowId, admin.id)?.status).toBe("pending");
  });

  it("stores the session for the connecting admin only once approved", async () => {
    const admin = await adminUser();
    const flow = await createChatgptProviderConnectionFlow(admin, PROFILE_ID);
    makePollDue(flow.flowId);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ authorization_code: "code_1", code_verifier: "verifier_1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: accessToken, refresh_token: "refresh_1", expires_in: 3600 }));

    await pollChatgptProviderConnectionFlow(flow.flowId, admin.id);

    expect(getProviderConnectionFlow(flow.flowId, admin.id)?.status).toBe("succeeded");
    const profile = getRuntimeProviderProfile(PROFILE_ID)!;
    expect(profile.credentials).toEqual({ accessToken, refreshToken: "refresh_1" });
    expect(profile.connectionMetadata).toMatchObject({
      accountLabel: "owner@example.com · ChatGPT Pro",
      ownerUserId: admin.id
    });
    expect(getProviderReadinessError(profile, admin.id)).toBeNull();
    expect(getProviderReadinessError(profile, "user_someone_else")).toContain("private");
  });

  it("fails expired flows, stale profile intents, and rejected exchanges without storing credentials", async () => {
    const admin = await adminUser();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const expired = await createChatgptProviderConnectionFlow(admin, PROFILE_ID);
    getDb().prepare("UPDATE provider_connection_flows SET expires_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", expired.flowId);
    await pollChatgptProviderConnectionFlow(expired.flowId, admin.id);
    expect(getProviderConnectionFlow(expired.flowId, admin.id)?.status).toBe("failed");

    const stale = await createChatgptProviderConnectionFlow(admin, PROFILE_ID);
    makePollDue(stale.flowId);
    claimProviderConnectionAttempt(PROFILE_ID);
    fetchMock.mockResolvedValueOnce(jsonResponse({ authorization_code: "code_1", code_verifier: "verifier_1" }));
    await pollChatgptProviderConnectionFlow(stale.flowId, admin.id);
    expect(getProviderConnectionFlow(stale.flowId, admin.id)?.status).toBe("failed");

    const rejected = await createChatgptProviderConnectionFlow(admin, PROFILE_ID);
    makePollDue(rejected.flowId);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ authorization_code: "code_2", code_verifier: "verifier_2" }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "invalid code" } }, 400));
    await pollChatgptProviderConnectionFlow(rejected.flowId, admin.id);
    expect(getProviderConnectionFlow(rejected.flowId, admin.id)?.status).toBe("failed");

    const broken = await createChatgptProviderConnectionFlow(admin, PROFILE_ID);
    getDb().prepare("UPDATE provider_connection_flows SET state_json = '{}' WHERE id = ?").run(broken.flowId);
    await pollChatgptProviderConnectionFlow(broken.flowId, admin.id);
    expect(getProviderConnectionFlow(broken.flowId, admin.id)?.status).toBe("failed");

    expect(getRuntimeProviderProfile(PROFILE_ID)!.credentials).toEqual({});
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("device_secret");
  });

  it("drives the flow through the native routes, polling on reads but never on cancel", async () => {
    const owner = await createLocalUser({
      username: "chatgpt-owner",
      password: "ChatgptOwner123!",
      role: "admin"
    });
    const otherAdmin = await createLocalUser({
      username: "chatgpt-other-admin",
      password: "ChatgptOtherAdmin123!",
      role: "admin"
    });
    const ownerSession = await createMobileSession(owner.id, "Owner device");
    const otherSession = await createMobileSession(otherAdmin.id, "Other device");
    const request = (token: string, path: string, method = "GET") => new Request(
      `https://eidon.example/api/v1/${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(method === "POST" ? { "content-type": "application/json" } : {})
        },
        ...(method === "POST" ? { body: JSON.stringify({}) } : {})
      }
    );
    const routeContext = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

    const startPath = `providers/${PROFILE_ID}/connection/flows`;
    const started = await postMobileRoute(request(ownerSession.token, startPath, "POST"), routeContext(startPath));
    expect(started.status).toBe(201);
    const startedBody = await started.clone().json() as { data: { flowId: string; userCode: string } };
    assertOpenApiResponse("/providers/{profileId}/connection/flows", "post", started.status, startedBody);
    expect(startedBody.data.userCode).toBe("ABCD-1234");

    const flowPath = `${startPath}/${startedBody.data.flowId}`;
    makePollDue(startedBody.data.flowId);
    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ authorization_code: "code_1", code_verifier: "verifier_1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: accessToken, refresh_token: "refresh_1", expires_in: 3600 }));

    const polled = await getMobileRoute(request(ownerSession.token, flowPath), routeContext(flowPath));
    expect(polled.status).toBe(200);
    const polledBody = await polled.json();
    assertOpenApiResponse("/providers/{profileId}/connection/flows/{flowId}", "get", 200, polledBody);
    expect(polledBody.data.flow.status).toBe("succeeded");
    expect(JSON.stringify(polledBody)).not.toMatch(/refresh_1|device_secret/);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "device_secret_2", user_code: "WXYZ-9876", interval: "5" });
      }
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        return jsonResponse({
          plan_type: "pro",
          rate_limit: {
            primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1_900_000_000 },
            secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1_900_100_000 }
          }
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const usagePath = `providers/${PROFILE_ID}/usage`;
    const usage = await getMobileRoute(request(ownerSession.token, usagePath), routeContext(usagePath));
    expect(usage.status).toBe(200);
    const usageBody = await usage.json();
    assertOpenApiResponse("/providers/{profileId}/usage", "get", 200, usageBody);
    expect(usageBody.data.usage.windows.map((window: { label: string }) => window.label))
      .toEqual(["5-hour", "Weekly"]);

    const blocked = await getMobileRoute(request(otherSession.token, usagePath), routeContext(usagePath));
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(await blocked.json())).toContain("private");

    const second = await postMobileRoute(request(ownerSession.token, startPath, "POST"), routeContext(startPath));
    const secondFlowId = (await second.json() as { data: { flowId: string } }).data.flowId;
    makePollDue(secondFlowId);
    fetchMock.mockClear();
    const secondPath = `${startPath}/${secondFlowId}`;
    const canceled = await deleteMobileRoute(request(ownerSession.token, secondPath, "DELETE"), routeContext(secondPath));
    expect(canceled.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getProviderConnectionFlow(secondFlowId, owner.id)?.status).toBe("canceled");
  });
});
