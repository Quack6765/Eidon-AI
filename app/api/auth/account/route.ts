import { z } from "zod";

import {
  clearSessionCookie,
  getSessionPayload,
  invalidateAllSessionsForUser,
  requireUser,
  updatePassword,
  updateUsername
} from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";

const schema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).optional().or(z.literal(""))
});

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = schema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid account payload");
  }

  await updateUsername(user.id, body.data.username);

  if (body.data.password) {
    await updatePassword(user.id, body.data.password);
    await invalidateAllSessionsForUser(user.id);

    const session = await getSessionPayload();

    if (session) {
      await clearSessionCookie();
    }
  }

  return ok({ success: true });
}
