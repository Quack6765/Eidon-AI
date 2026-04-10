import { z } from "zod";

import { authenticateUser, createSession, setSessionCookie } from "@/lib/auth";
import { isPasswordLoginEnabled } from "@/lib/env";
import { badRequest, ok } from "@/lib/http";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  if (!isPasswordLoginEnabled()) {
    return badRequest("Username/password login is disabled", 403);
  }

  const body = schema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid login payload");
  }

  const user = await authenticateUser(body.data.username, body.data.password);
  if (!user) {
    return badRequest("Invalid username or password", 401);
  }

  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt, request);

  return ok({ user });
}
