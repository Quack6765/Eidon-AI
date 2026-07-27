import { z } from "zod";

import { authenticateUser, createMobileSession } from "@/lib/auth";
import { MOBILE_DEVICE_NAME_MAX_CHARS } from "@/lib/constants";
import { isPasswordLoginEnabled } from "@/lib/env";
import {
  consumeMobileLoginAttempt,
  getMobileRequestSourceAddress,
  isSecureMobileRequest,
  mobileApiError,
  mobileApiSuccess,
  recordMobileSecurityEvent,
  resetMobileLoginAttempts
} from "@/lib/mobile-api";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(4096),
  deviceName: z.string().trim().min(1).max(MOBILE_DEVICE_NAME_MAX_CHARS)
});

export async function POST(request: Request) {
  if (!isSecureMobileRequest(request)) {
    return mobileApiError(
      "insecure_transport",
      "A trusted HTTPS connection is required",
      400
    );
  }

  if (!isPasswordLoginEnabled()) {
    return mobileApiError("login_disabled", "Password login is disabled", 403);
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return mobileApiError("invalid_request", "Invalid login payload", 400);
  }

  const sourceAddress = getMobileRequestSourceAddress(request);
  const rateLimit = consumeMobileLoginAttempt(parsed.data.username, sourceAddress);
  if (!rateLimit.allowed) {
    recordMobileSecurityEvent("login", {
      username: parsed.data.username,
      sourceAddress,
      outcome: "rate_limited"
    });
    return mobileApiError("rate_limited", "Too many login attempts", 429, {
      headers: { "retry-after": String(rateLimit.retryAfterSeconds) }
    });
  }

  const user = await authenticateUser(parsed.data.username, parsed.data.password);
  if (!user) {
    recordMobileSecurityEvent("login", {
      username: parsed.data.username,
      sourceAddress,
      outcome: "invalid_credentials"
    });
    return mobileApiError("invalid_credentials", "Invalid username or password", 401);
  }

  const session = await createMobileSession(user.id, parsed.data.deviceName);
  resetMobileLoginAttempts(parsed.data.username, sourceAddress);
  recordMobileSecurityEvent("login", {
    username: parsed.data.username,
    sourceAddress,
    sessionId: session.sessionId,
    outcome: "success"
  });

  return mobileApiSuccess(
    {
      tokenType: "Bearer",
      accessToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user
    },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
}
