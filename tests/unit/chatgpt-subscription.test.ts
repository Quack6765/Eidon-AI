import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildChatgptHeaders,
  CHATGPT_DEVICE_LOGIN_DISABLED_MESSAGE,
  exchangeChatgptAuthorizationCode,
  getChatgptTokenClaims,
  getChatgptUsageLimits,
  listChatgptModels,
  normalizeChatgptUsage,
  pollChatgptDeviceAuthorization,
  refreshChatgptTokens,
  requestChatgptDeviceCode,
  shouldRefreshChatgptToken
} from "@/lib/chatgpt-subscription";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

function fakeChatgptJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

const accessToken = fakeChatgptJwt({
  exp: 1_900_000_000,
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct_123",
    chatgpt_plan_type: "plus",
    chatgpt_compute_residency: "eu"
  },
  "https://api.openai.com/profile": { email: "owner@example.com" }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function chatgptProfile(overrides: Parameters<typeof createRuntimeProviderProfile>[0] = {}) {
  return createRuntimeProviderProfile({
    providerKind: "chatgpt_subscription",
    providerConfig: {},
    credentials: { accessToken, refreshToken: "refresh_1" },
    ...overrides
  });
}

describe("chatgpt subscription protocol", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts a device code sign-in and clamps the poll interval", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      device_auth_id: "device_1",
      usercode: "ABCD-EFGH",
      interval: "1"
    }));

    await expect(requestChatgptDeviceCode()).resolves.toEqual({
      deviceAuthId: "device_1",
      userCode: "ABCD-EFGH",
      intervalSeconds: 3
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
    expect(JSON.parse(String(init.body))).toEqual({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ device_auth_id: "device_2", user_code: "WXYZ" }));
    await expect(requestChatgptDeviceCode()).resolves.toMatchObject({ intervalSeconds: 5 });
  });

  it("explains how to enable device code login when the account has it turned off", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(requestChatgptDeviceCode()).rejects.toThrow(CHATGPT_DEVICE_LOGIN_DISABLED_MESSAGE);

    fetchMock.mockResolvedValueOnce(jsonResponse({ device_auth_id: "device_1" }));
    await expect(requestChatgptDeviceCode()).rejects.toThrow("invalid device code");
  });

  it("treats unfinished device authorization as pending and returns the code once approved", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(pollChatgptDeviceAuthorization("device_1", "ABCD")).resolves.toEqual({ status: "pending" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "slow_down" } }, 429));
    await expect(pollChatgptDeviceAuthorization("device_1", "ABCD")).resolves.toEqual({ status: "pending" });

    fetchMock.mockResolvedValueOnce(jsonResponse({
      authorization_code: "code_1",
      code_challenge: "challenge",
      code_verifier: "verifier_1"
    }));
    await expect(pollChatgptDeviceAuthorization("device_1", "ABCD")).resolves.toEqual({
      status: "authorized",
      authorizationCode: "code_1",
      codeVerifier: "verifier_1"
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body))).toEqual({
      device_auth_id: "device_1",
      user_code: "ABCD"
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Code expired" } }, 400));
    await expect(pollChatgptDeviceAuthorization("device_1", "ABCD")).rejects.toThrow("Code expired");

    fetchMock.mockResolvedValueOnce(jsonResponse({ authorization_code: "code_1" }));
    await expect(pollChatgptDeviceAuthorization("device_1", "ABCD")).rejects.toThrow("invalid authorization");
  });

  it("exchanges the device authorization for a session labelled with the account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: accessToken,
      refresh_token: "refresh_1",
      id_token: fakeChatgptJwt({ email: "owner@example.com" }),
      expires_in: 3600
    }));

    await expect(exchangeChatgptAuthorizationCode("code_1", "verifier_1")).resolves.toEqual({
      accessToken,
      refreshToken: "refresh_1",
      expiresAt: "2026-10-08T11:00:00.000Z",
      accountLabel: "owner@example.com · ChatGPT Plus"
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.openai.com/oauth/token");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant_type: "authorization_code",
      code: "code_1",
      code_verifier: "verifier_1",
      redirect_uri: "https://auth.openai.com/deviceauth/callback"
    });
  });

  it("refreshes with the rotating refresh token and falls back to the token expiry claim", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: accessToken, refresh_token: "refresh_2" }));

    await expect(refreshChatgptTokens(chatgptProfile())).resolves.toEqual({
      accessToken,
      refreshToken: "refresh_2",
      expiresAt: new Date(1_900_000_000 * 1000).toISOString()
    });
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).get("refresh_token")).toBe("refresh_1");

    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: accessToken }));
    await expect(refreshChatgptTokens(chatgptProfile())).resolves.toMatchObject({ refreshToken: "refresh_1" });
  });

  it("reports an ended session when the refresh token is no longer accepted", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "refresh_token_reused" }, 401));
    await expect(refreshChatgptTokens(chatgptProfile())).rejects.toThrow("Reconnect the account");

    await expect(
      refreshChatgptTokens(chatgptProfile({ credentials: { accessToken } }))
    ).rejects.toThrow("Reconnect the account");

    fetchMock.mockResolvedValueOnce(jsonResponse({ error_description: "Service unavailable" }, 503));
    await expect(refreshChatgptTokens(chatgptProfile())).rejects.toThrow("Service unavailable");
  });

  it("refreshes only when the access token is close to expiring", () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 60 * 60_000).toISOString();

    expect(shouldRefreshChatgptToken(chatgptProfile({ connectionMetadata: { expiresAt: soon } }))).toBe(true);
    expect(shouldRefreshChatgptToken(chatgptProfile({ connectionMetadata: { expiresAt: later } }))).toBe(false);
    expect(shouldRefreshChatgptToken(chatgptProfile({ connectionMetadata: {} }))).toBe(false);
  });

  it("decodes account claims and builds identifying request headers", () => {
    expect(getChatgptTokenClaims(accessToken)).toEqual({
      accountId: "acct_123",
      planType: "plus",
      email: "owner@example.com",
      residency: "eu",
      expiresAt: new Date(1_900_000_000 * 1000).toISOString()
    });
    expect(getChatgptTokenClaims("not-a-jwt").accountId).toBeNull();

    expect(buildChatgptHeaders(accessToken, "conv_1")).toEqual({
      "ChatGPT-Account-Id": "acct_123",
      originator: "eidon",
      "User-Agent": "eidon/dev",
      "session-id": "conv_1",
      "x-openai-internal-codex-residency": "eu"
    });
    expect(() => buildChatgptHeaders(fakeChatgptJwt({}))).toThrow("missing its account");
  });

  it("lists only the models the subscription offers in pickers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      models: [
        { slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list", context_window: 400000 },
        { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" },
        { slug: "gpt-5.5" },
        { display_name: "No slug" }
      ]
    }));

    await expect(listChatgptModels(chatgptProfile())).resolves.toEqual([
      { id: "gpt-6-luna", name: "GPT-6 Luna", maxContextWindowTokens: 400000 },
      { id: "gpt-5.5", name: "gpt-5.5", maxContextWindowTokens: null }
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.161.0");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${accessToken}`,
      "ChatGPT-Account-Id": "acct_123"
    });
  });

  it("asks for reconnection when a backend request is unauthorized", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Unauthorized" }, 401));
    await expect(getChatgptUsageLimits(chatgptProfile())).rejects.toThrow("Reconnect the account");

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Too many requests" } }, 429));
    await expect(getChatgptUsageLimits(chatgptProfile())).rejects.toThrow("Too many requests");
  });

  it("labels usage windows by their length, shortest first", async () => {
    const now = Date.parse("2026-10-08T10:00:00.000Z");
    fetchMock.mockResolvedValueOnce(jsonResponse({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_at: 1_791_460_800 },
        secondary_window: { used_percent: 130, limit_window_seconds: 604800, reset_after_seconds: 3600 }
      }
    }));

    const usage = await getChatgptUsageLimits(chatgptProfile());
    expect(usage.planLabel).toBe("ChatGPT Plus");
    expect(usage.windows.map(({ label, usedPercent }) => ({ label, usedPercent }))).toEqual([
      { label: "5-hour", usedPercent: 42 },
      { label: "Weekly", usedPercent: 100 }
    ]);
    expect(usage.windows[0].resetsAt).toBe(new Date(1_791_460_800 * 1000).toISOString());
    expect(fetchMock.mock.calls[0][0]).toBe("https://chatgpt.com/backend-api/wham/usage");

    expect(normalizeChatgptUsage({
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 7, limit_window_seconds: 604800, reset_after_seconds: 3600 },
        secondary_window: null
      }
    }, now)).toEqual({
      planLabel: "ChatGPT Pro",
      windows: [{
        label: "Weekly",
        usedPercent: 7,
        windowSeconds: 604800,
        resetsAt: "2026-10-08T11:00:00.000Z"
      }],
      fetchedAt: "2026-10-08T10:00:00.000Z"
    });
  });

  it("describes uncommon window lengths and missing fields without failing", () => {
    const usage = normalizeChatgptUsage({
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 7200 },
        secondary_window: { used_percent: 2, limit_window_seconds: 3 * 24 * 3600 }
      }
    });
    expect(usage.planLabel).toBeNull();
    expect(usage.windows.map((window) => [window.label, window.resetsAt])).toEqual([
      ["2-hour", null],
      ["3-day", null]
    ]);
    expect(normalizeChatgptUsage({ rate_limit: { primary_window: { used_percent: 5 } } }).windows[0].label)
      .toBe("Usage");
    expect(normalizeChatgptUsage({}).windows).toEqual([]);
  });
});
