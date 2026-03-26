import { clearSessionCookie, getSessionPayload, invalidateSession } from "@/lib/auth";
import { ok } from "@/lib/http";

export async function POST() {
  const session = await getSessionPayload();

  if (session) {
    await invalidateSession(session.sessionId);
  }

  await clearSessionCookie();

  return ok({ success: true });
}
