import { createHash } from "node:crypto";

import { isProduction } from "@/lib/env";

export type MobileApiErrorCode =
  | "authentication_required"
  | "invalid_credentials"
  | "login_disabled"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "unsupported_method"
  | "insecure_transport"
  | "internal_error";

function normalizeResponseKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const blockedResponseKeys = new Set([
  "apiKey",
  "apiKeyEncrypted",
  "accessToken",
  "bearerToken",
  "bearerTokenEncrypted",
  "comfyuiBearerToken",
  "debug",
  "credential",
  "credentials",
  "credentialsEncrypted",
  "exaApiKey",
  "extractedText",
  "githubRefreshToken",
  "githubRefreshTokenEncrypted",
  "githubUserAccessToken",
  "githubUserAccessTokenEncrypted",
  "googleNanoBananaApiKey",
  "headers",
  "externalSttApiKey",
  "passwordHash",
  "relativePath",
  "refreshToken",
  "shareToken",
  "tavilyApiKey",
  "token",
  "env"
].map(normalizeResponseKey));

type LoginAttempt = {
  count: number;
  firstAttemptAt: number;
  blockedUntil: number;
  lastAttemptAt: number;
};

const loginAttempts = new Map<string, LoginAttempt>();
const loginWindowMs = 15 * 60 * 1000;
const loginBlockMs = 15 * 60 * 1000;
const loginAttemptLimit = 5;
const maxLoginAttemptKeys = 10_000;
const maxErrorMessageChars = 512;
const maxErrorDetailStringChars = 1_000;
const maxErrorDetailItems = 50;
const maxErrorDetailDepth = 5;

export function sanitizeMobilePayload(
  value: unknown,
  allowedTopLevelKeys = new Set<string>(),
  depth = 0
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMobilePayload(item, allowedTopLevelKeys, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      blockedResponseKeys.has(normalizeResponseKey(key)) &&
      !(depth === 0 && allowedTopLevelKeys.has(normalizeResponseKey(key)))
        ? []
        : [[key, sanitizeMobilePayload(child, allowedTopLevelKeys, depth + 1)]]
    )
  );
}

export function mobileApiSuccess(
  data: unknown,
  init?: ResponseInit,
  options?: { allowedTopLevelKeys?: string[] }
) {
  const allowed = new Set(
    (options?.allowedTopLevelKeys ?? []).map(normalizeResponseKey)
  );
  return Response.json({ data: sanitizeMobilePayload(data, allowed) }, init);
}

function boundMobileErrorDetails(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.slice(0, maxErrorDetailStringChars);
  }
  if (Array.isArray(value)) {
    if (depth >= maxErrorDetailDepth) return [];
    return value
      .slice(0, maxErrorDetailItems)
      .map((item) => boundMobileErrorDetails(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  if (depth >= maxErrorDetailDepth) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, maxErrorDetailItems)
      .map(([key, item]) => [key, boundMobileErrorDetails(item, depth + 1)])
  );
}

export function mobileApiError(
  code: MobileApiErrorCode,
  message: string,
  status: number,
  options?: { details?: unknown; headers?: HeadersInit }
) {
  return Response.json(
    {
      error: {
        code,
        message: message.slice(0, maxErrorMessageChars),
        ...(options?.details === undefined
          ? {}
          : {
              details: boundMobileErrorDetails(
                sanitizeMobilePayload(options.details)
              )
            })
      }
    },
    { status, headers: options?.headers }
  );
}

function codeForStatus(status: number): MobileApiErrorCode {
  if (status === 401) return "authentication_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 405) return "unsupported_method";
  if (status === 409) return "conflict";
  if (status >= 500) return "internal_error";
  return "invalid_request";
}

export async function normalizeMobileApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  const body = await response.json().catch(() => ({})) as {
    error?: unknown;
    details?: unknown;
    [key: string]: unknown;
  };

  if (!response.ok) {
    const message = response.status >= 500
      ? "Unable to complete the request"
      : typeof body.error === "string"
        ? body.error
        : "Request failed";
    return mobileApiError(codeForStatus(response.status), message, response.status, {
      details: body.details
    });
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("set-cookie");
  headers.set("content-type", "application/json; charset=utf-8");
  return mobileApiSuccess(body, { status: response.status, headers });
}

function parseForwardedProtocol(request: Request) {
  const forwarded = request.headers.get("forwarded");
  const xForwardedProto = request.headers.get("x-forwarded-proto");

  if (forwarded?.includes(",") || xForwardedProto?.includes(",")) {
    return { protocol: null, ambiguous: true };
  }

  const forwardedMatches = forwarded
    ? [...forwarded.matchAll(/(?:^|;)\s*proto=(?:"([^"]+)"|([^;,\s]+))/gi)]
    : [];
  if (forwardedMatches.length > 1) {
    return { protocol: null, ambiguous: true };
  }
  const forwardedProtocol = (
    forwardedMatches[0]?.[1] ?? forwardedMatches[0]?.[2]
  )?.toLowerCase();
  const legacyProtocol = xForwardedProto?.trim().toLowerCase();

  if (forwardedProtocol && legacyProtocol && forwardedProtocol !== legacyProtocol) {
    return { protocol: null, ambiguous: true };
  }

  return {
    protocol: forwardedProtocol ?? legacyProtocol ?? new URL(request.url).protocol.replace(":", ""),
    ambiguous: false
  };
}

export function isSecureMobileRequest(request: Request) {
  if (!isProduction()) return true;
  const result = parseForwardedProtocol(request);
  if (result.ambiguous || result.protocol !== "https") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost?.includes(",")) return false;
  const expectedHost = forwardedHost?.trim() || request.headers.get("host") || new URL(request.url).host;

  try {
    return new URL(origin).origin === `https://${expectedHost}`;
  } catch {
    return false;
  }
}

export function getMobileRequestSourceAddress(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (realIp || forwardedFor || "unknown").slice(0, 128);
}

function loginAttemptKey(username: string, sourceAddress: string) {
  return createHash("sha256")
    .update(username.trim().toLowerCase())
    .update("\0")
    .update(sourceAddress)
    .digest("hex");
}

function pruneLoginAttempts(now: number) {
  for (const [key, attempt] of loginAttempts) {
    if (attempt.blockedUntil <= now && now - attempt.lastAttemptAt > loginWindowMs) {
      loginAttempts.delete(key);
    }
  }

  while (loginAttempts.size >= maxLoginAttemptKeys) {
    const oldest = loginAttempts.keys().next().value as string | undefined;
    if (!oldest) break;
    loginAttempts.delete(oldest);
  }
}

export function consumeMobileLoginAttempt(
  username: string,
  sourceAddress: string,
  now = Date.now()
) {
  pruneLoginAttempts(now);
  const key = loginAttemptKey(username, sourceAddress);
  const existing = loginAttempts.get(key);

  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.blockedUntil - now) / 1000))
    };
  }

  const withinWindow = existing && now - existing.firstAttemptAt <= loginWindowMs;
  const count = withinWindow ? existing.count + 1 : 1;
  const firstAttemptAt = withinWindow ? existing.firstAttemptAt : now;
  const blockedUntil = count > loginAttemptLimit ? now + loginBlockMs : 0;
  loginAttempts.delete(key);
  loginAttempts.set(key, { count, firstAttemptAt, blockedUntil, lastAttemptAt: now });

  if (blockedUntil) {
    return { allowed: false as const, retryAfterSeconds: loginBlockMs / 1000 };
  }

  return { allowed: true as const, retryAfterSeconds: 0 };
}

export function resetMobileLoginAttempts(
  username: string,
  sourceAddress: string
) {
  loginAttempts.delete(loginAttemptKey(username, sourceAddress));
}

export function resetMobileLoginRateLimiterForTests() {
  loginAttempts.clear();
}

export function recordMobileSecurityEvent(
  event: string,
  input: { username?: string; sourceAddress?: string; sessionId?: string; outcome: string }
) {
  const subject = input.username
    ? createHash("sha256").update(input.username.trim().toLowerCase()).digest("hex").slice(0, 12)
    : undefined;
  const source = input.sourceAddress
    ? createHash("sha256").update(input.sourceAddress).digest("hex").slice(0, 12)
    : undefined;
  console.info("[mobile-security]", {
    event,
    outcome: input.outcome,
    ...(subject ? { subject } : {}),
    ...(source ? { source } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {})
  });
}
