import { auditLog, clearSessionCookie, getSessionPayload, invalidateSession } from "@/lib/auth";
import { ok } from "@/lib/http";

export async function POST() {
  const session = await getSessionPayload();

  if (session) {
    await invalidateSession(session.sessionId);
    auditLog({
      eventType: "logout",
      userId: session.userId,
      detail: "Session terminated via logout"
    });
  }

  await clearSessionCookie();

  return ok({ success: true });
}
