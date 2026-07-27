import {
  authenticateMobileRequest,
  listMobileSessionsForUser
} from "@/lib/auth";
import { isSecureMobileRequest, mobileApiError, mobileApiSuccess } from "@/lib/mobile-api";

export async function GET(request: Request) {
  if (!isSecureMobileRequest(request)) {
    return mobileApiError("insecure_transport", "A trusted HTTPS connection is required", 400);
  }

  const authenticated = await authenticateMobileRequest(request);
  if (!authenticated) {
    return mobileApiError("authentication_required", "Invalid or expired mobile session", 401, {
      headers: { "www-authenticate": "Bearer" }
    });
  }

  return mobileApiSuccess({
    sessions: listMobileSessionsForUser(authenticated.user.id).map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      current: session.id === authenticated.sessionId
    }))
  });
}
