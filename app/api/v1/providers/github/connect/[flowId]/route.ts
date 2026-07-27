import { authenticateMobileRequest } from "@/lib/auth";
import {
  cancelMobileGithubOauthFlow,
  getMobileGithubOauthFlowForUser
} from "@/lib/mobile-github-oauth";
import { isSecureMobileRequest, mobileApiError, mobileApiSuccess } from "@/lib/mobile-api";

export async function GET(
  request: Request,
  context: { params: Promise<{ flowId: string }> }
) {
  if (!isSecureMobileRequest(request)) {
    return mobileApiError("insecure_transport", "A trusted HTTPS connection is required", 400);
  }
  const authenticated = await authenticateMobileRequest(request);
  if (!authenticated) {
    return mobileApiError("authentication_required", "Invalid or expired mobile session", 401);
  }
  if (authenticated.user.role !== "admin") {
    return mobileApiError("forbidden", "Administrator access is required", 403);
  }
  const { flowId } = await context.params;
  const flow = getMobileGithubOauthFlowForUser(flowId, authenticated.user.id);
  return flow
    ? mobileApiSuccess({ flow })
    : mobileApiError("not_found", "OAuth flow not found", 404);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ flowId: string }> }
) {
  if (!isSecureMobileRequest(request)) {
    return mobileApiError("insecure_transport", "A trusted HTTPS connection is required", 400);
  }
  const authenticated = await authenticateMobileRequest(request);
  if (!authenticated) {
    return mobileApiError("authentication_required", "Invalid or expired mobile session", 401);
  }
  if (authenticated.user.role !== "admin") {
    return mobileApiError("forbidden", "Administrator access is required", 403);
  }
  const { flowId } = await context.params;
  return cancelMobileGithubOauthFlow(flowId, authenticated.user.id)
    ? mobileApiSuccess({ success: true })
    : mobileApiError("conflict", "OAuth flow cannot be canceled", 409);
}
