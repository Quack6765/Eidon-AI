import { authenticateMobileRequest, invalidateSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isSecureMobileRequest, mobileApiError, mobileApiSuccess } from "@/lib/mobile-api";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  if (!isSecureMobileRequest(request)) {
    return mobileApiError("insecure_transport", "A trusted HTTPS connection is required", 400);
  }

  const authenticated = await authenticateMobileRequest(request);
  if (!authenticated) {
    return mobileApiError("authentication_required", "Invalid or expired mobile session", 401, {
      headers: { "www-authenticate": "Bearer" }
    });
  }

  const { sessionId } = await context.params;
  const owned = getDb()
    .prepare(
      "SELECT id FROM auth_sessions WHERE id = ? AND user_id = ? AND purpose = 'mobile'"
    )
    .get(sessionId, authenticated.user.id);
  if (!owned) {
    return mobileApiError("not_found", "Mobile session not found", 404);
  }

  await invalidateSession(sessionId);
  return mobileApiSuccess({ success: true, currentSessionRevoked: sessionId === authenticated.sessionId });
}
