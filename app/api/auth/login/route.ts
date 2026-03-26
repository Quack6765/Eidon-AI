import { z } from "zod";

import {
  createSession,
  findUserByUsername,
  setSessionCookie,
  verifyPassword
} from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const body = schema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid login payload");
  }

  const result = await findUserByUsername(body.data.username);

  if (!result) {
    return badRequest("Invalid username or password", 401);
  }

  const matches = await verifyPassword(body.data.password, result.passwordHash);

  if (!matches) {
    return badRequest("Invalid username or password", 401);
  }

  const session = await createSession(result.user.id);
  await setSessionCookie(session.token, session.expiresAt);

  return ok({ user: result.user });
}
