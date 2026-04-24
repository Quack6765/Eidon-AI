import { z } from "zod";

import { authenticateUser, createSession, setSessionCookie } from "@/lib/auth";
import { badRequest, ok, tooManyRequests } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPasswordLoginEnabled } from "@/lib/env";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

export async function POST(request: Request) {
  if (!isPasswordLoginEnabled()) {
    return badRequest("Username/password login is disabled", 403);
  }

  const body = schema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid login payload");
  }

  const ip = getClientIp(request);
  const rlKey = `login:${ip}`;
  const rl = checkRateLimit(rlKey);
  if (!rl.allowed) {
    return tooManyRequests("Too many login attempts. Try again later.", rl.resetAt);
  }

  const userAgent = request.headers.get("user-agent") || undefined;
  const user = await authenticateUser(body.data.username, body.data.password, {
    ipAddress: ip,
    userAgent
  });

  if (!user) {
    return badRequest("Invalid username or password", 401);
  }

  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt, request);

  return ok({ user });
}
