import { APP_NAME, getAppVersion } from "@/lib/constants";
import type { OAuthTokenRefresh } from "@/lib/provider-oauth-refresh";
import type { ProviderUsageLimits, ProviderUsageWindow } from "@/lib/provider-adapters/types";
import type { RuntimeProviderProfile } from "@/lib/types";

export const CHATGPT_LABEL = "ChatGPT";
export const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CHATGPT_DEVICE_CODE_LIFETIME_MS = 15 * 60 * 1000;
export const CHATGPT_DEVICE_LOGIN_DISABLED_MESSAGE =
  "Device code sign-in is turned off for this ChatGPT account. Turn on device code login in ChatGPT under Settings, Security, then try again.";

const AUTH_ISSUER = "https://auth.openai.com";
const DEVICE_REDIRECT_URI = `${AUTH_ISSUER}/deviceauth/callback`;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const MODELS_CLIENT_VERSION = "0.161.0";
const ORIGINATOR = APP_NAME.toLowerCase();
const AUTH_CLAIM = "https://api.openai.com/auth";
const PROFILE_CLAIM = "https://api.openai.com/profile";
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const MIN_POLL_INTERVAL_SECONDS = 3;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const PERMANENT_REFRESH_ERRORS = new Set([
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
  "invalid_grant"
]);
const PENDING_DEVICE_ERRORS = new Set(["deviceauth_authorization_pending", "slow_down"]);

export type ChatgptTokenClaims = {
  accountId: string | null;
  planType: string | null;
  email: string | null;
  residency: string | null;
  expiresAt: string | null;
};

export type ChatgptTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  accountLabel: string | null;
};

export type ChatgptDeviceCode = {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
};

export type ChatgptDevicePoll =
  | { status: "pending" }
  | { status: "authorized"; authorizationCode: string; codeVerifier: string };

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function decodeJwtPayload(token: string | null | undefined): JsonObject | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    return asObject(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

export function getChatgptTokenClaims(accessToken: string, idToken?: string): ChatgptTokenClaims {
  const access = decodeJwtPayload(accessToken);
  const identity = decodeJwtPayload(idToken);
  const auth = asObject(access?.[AUTH_CLAIM]) ?? asObject(identity?.[AUTH_CLAIM]);
  const profile = asObject(access?.[PROFILE_CLAIM]);
  const exp = asNumber(access?.exp);
  return {
    accountId: asString(auth?.chatgpt_account_id),
    planType: asString(auth?.chatgpt_plan_type),
    email: asString(identity?.email) ?? asString(profile?.email),
    residency: asString(auth?.chatgpt_compute_residency) ?? asString(auth?.chatgpt_data_residency),
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null
  };
}

export function formatChatgptPlan(planType: string | null) {
  if (!planType) return null;
  return `ChatGPT ${planType.charAt(0).toUpperCase()}${planType.slice(1)}`;
}

function formatAccountLabel(claims: ChatgptTokenClaims) {
  const parts = [claims.email, formatChatgptPlan(claims.planType)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

async function readJson(response: Response) {
  return asObject(await response.json().catch(() => null));
}

function getErrorCode(body: JsonObject | null) {
  const error = body?.error;
  return asString(asObject(error)?.code) ?? asString(error) ?? asString(body?.code);
}

function getErrorMessage(body: JsonObject | null, fallback: string) {
  const error = body?.error;
  return asString(asObject(error)?.message) ?? asString(body?.error_description) ?? fallback;
}

export async function requestChatgptDeviceCode(): Promise<ChatgptDeviceCode> {
  const response = await fetch(`${AUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID })
  });
  if (response.status === 404) {
    throw new Error(CHATGPT_DEVICE_LOGIN_DISABLED_MESSAGE);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(body, `ChatGPT sign-in failed with status ${response.status}`));
  }

  const deviceAuthId = asString(body?.device_auth_id);
  const userCode = asString(body?.user_code) ?? asString(body?.usercode);
  if (!deviceAuthId || !userCode) {
    throw new Error("ChatGPT sign-in returned an invalid device code");
  }
  const interval = Number.parseInt(String(body?.interval ?? ""), 10);
  return {
    deviceAuthId,
    userCode,
    intervalSeconds: Number.isFinite(interval)
      ? Math.max(interval, MIN_POLL_INTERVAL_SECONDS)
      : DEFAULT_POLL_INTERVAL_SECONDS
  };
}

export async function pollChatgptDeviceAuthorization(
  deviceAuthId: string,
  userCode: string
): Promise<ChatgptDevicePoll> {
  const response = await fetch(`${AUTH_ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode })
  });
  const body = await readJson(response);
  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }
  if (!response.ok) {
    const code = getErrorCode(body);
    if (code && PENDING_DEVICE_ERRORS.has(code)) return { status: "pending" };
    throw new Error(getErrorMessage(body, `ChatGPT sign-in failed with status ${response.status}`));
  }

  const authorizationCode = asString(body?.authorization_code);
  const codeVerifier = asString(body?.code_verifier);
  if (!authorizationCode || !codeVerifier) {
    throw new Error("ChatGPT sign-in returned an invalid authorization");
  }
  return { status: "authorized", authorizationCode, codeVerifier };
}

async function requestTokens(params: Record<string, string>, previousRefreshToken?: string) {
  const response = await fetch(`${AUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CHATGPT_CLIENT_ID, ...params }).toString()
  });
  const body = await readJson(response);
  if (!response.ok) {
    const code = getErrorCode(body);
    if (code && PERMANENT_REFRESH_ERRORS.has(code)) {
      throw new Error("The ChatGPT session has ended. Reconnect the account in provider settings.");
    }
    throw new Error(getErrorMessage(body, `ChatGPT token request failed with status ${response.status}`));
  }

  const accessToken = asString(body?.access_token);
  const refreshToken = asString(body?.refresh_token) ?? previousRefreshToken ?? null;
  if (!accessToken || !refreshToken) {
    throw new Error("ChatGPT did not return a usable session");
  }
  const claims = getChatgptTokenClaims(accessToken, asString(body?.id_token) ?? undefined);
  const expiresIn = asNumber(body?.expires_in);
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresIn && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : claims.expiresAt,
    accountLabel: formatAccountLabel(claims)
  } satisfies ChatgptTokens;
}

export function exchangeChatgptAuthorizationCode(authorizationCode: string, codeVerifier: string) {
  return requestTokens({
    grant_type: "authorization_code",
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: DEVICE_REDIRECT_URI
  });
}

export async function refreshChatgptTokens(profile: RuntimeProviderProfile): Promise<OAuthTokenRefresh> {
  const refreshToken = profile.credentials.refreshToken ?? "";
  if (!refreshToken) {
    throw new Error("The ChatGPT session has ended. Reconnect the account in provider settings.");
  }
  const tokens = await requestTokens({ grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken);
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt
  };
}

export function shouldRefreshChatgptToken(profile: RuntimeProviderProfile) {
  const expiresAt = profile.connectionMetadata.expiresAt;
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - Date.now() < REFRESH_THRESHOLD_MS;
}

export function buildChatgptHeaders(accessToken: string, conversationId?: string) {
  const claims = getChatgptTokenClaims(accessToken);
  if (!claims.accountId) {
    throw new Error("The ChatGPT session is missing its account. Reconnect the account in provider settings.");
  }
  return {
    "ChatGPT-Account-Id": claims.accountId,
    originator: ORIGINATOR,
    "User-Agent": `${ORIGINATOR}/${getAppVersion()}`,
    ...(conversationId ? { "session-id": conversationId } : {}),
    ...(claims.residency ? { "x-openai-internal-codex-residency": claims.residency } : {})
  };
}

async function fetchChatgptJson(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...buildChatgptHeaders(accessToken)
    }
  });
  const body = await readJson(response);
  if (response.status === 401) {
    throw new Error("The ChatGPT session has ended. Reconnect the account in provider settings.");
  }
  if (!response.ok || !body) {
    throw new Error(getErrorMessage(body, `ChatGPT request failed with status ${response.status}`));
  }
  return body;
}

export async function listChatgptModels(profile: RuntimeProviderProfile) {
  const url = `${CHATGPT_CODEX_BASE_URL}/models?client_version=${MODELS_CLIENT_VERSION}`;
  const body = await fetchChatgptJson(url, profile.credentials.accessToken ?? "");
  const models = Array.isArray(body.models) ? body.models : [];
  return models.flatMap((entry) => {
    const model = asObject(entry);
    const id = asString(model?.slug);
    if (!model || !id || (model.visibility !== undefined && model.visibility !== "list")) return [];
    return [{
      id,
      name: asString(model.display_name) ?? id,
      maxContextWindowTokens: asNumber(model.context_window)
    }];
  });
}

const WINDOW_LABELS = [
  { seconds: 5 * 60 * 60, label: "5-hour" },
  { seconds: 24 * 60 * 60, label: "Daily" },
  { seconds: 7 * 24 * 60 * 60, label: "Weekly" },
  { seconds: 30 * 24 * 60 * 60, label: "Monthly" }
];

function labelUsageWindow(windowSeconds: number | null) {
  if (!windowSeconds) return "Usage";
  const match = WINDOW_LABELS.find(({ seconds }) => Math.abs(windowSeconds - seconds) <= seconds * 0.05);
  if (match) return match.label;
  const hours = Math.round(windowSeconds / 3600);
  return hours < 48 ? `${hours}-hour` : `${Math.round(hours / 24)}-day`;
}

function toUsageWindow(value: unknown, now: number): ProviderUsageWindow | null {
  const window = asObject(value);
  const usedPercent = asNumber(window?.used_percent);
  if (!window || usedPercent === null) return null;
  const windowSeconds = asNumber(window.limit_window_seconds);
  const resetAt = asNumber(window.reset_at);
  const resetAfter = asNumber(window.reset_after_seconds);
  const resetsAt = resetAt
    ? new Date(resetAt * 1000).toISOString()
    : resetAfter !== null
      ? new Date(now + resetAfter * 1000).toISOString()
      : null;
  return {
    label: labelUsageWindow(windowSeconds),
    usedPercent: Math.min(Math.max(usedPercent, 0), 100),
    windowSeconds,
    resetsAt
  };
}

export function normalizeChatgptUsage(body: JsonObject, now = Date.now()): ProviderUsageLimits {
  const rateLimit = asObject(body.rate_limit);
  const windows = [rateLimit?.primary_window, rateLimit?.secondary_window]
    .map((window) => toUsageWindow(window, now))
    .filter((window): window is ProviderUsageWindow => Boolean(window))
    .sort((a, b) => (a.windowSeconds ?? 0) - (b.windowSeconds ?? 0));
  return {
    planLabel: formatChatgptPlan(asString(body.plan_type)),
    windows,
    fetchedAt: new Date(now).toISOString()
  };
}

export async function getChatgptUsageLimits(profile: RuntimeProviderProfile) {
  const body = await fetchChatgptJson(USAGE_URL, profile.credentials.accessToken ?? "");
  return normalizeChatgptUsage(body);
}
