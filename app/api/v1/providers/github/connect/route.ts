import { z } from "zod";

import { authenticateMobileRequest } from "@/lib/auth";
import {
  createMobileGithubOauthFlow
} from "@/lib/mobile-github-oauth";
import { isSecureMobileRequest, mobileApiError, mobileApiSuccess } from "@/lib/mobile-api";

const inputSchema = z.object({ providerProfileId: z.string().min(1) });

export async function POST(request: Request) {
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

  const body = inputSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return mobileApiError("invalid_request", "Invalid OAuth request", 400);

  try {
    return mobileApiSuccess(
      await createMobileGithubOauthFlow(authenticated.user, body.data.providerProfileId),
      { status: 201, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return mobileApiError(
      "invalid_request",
      error instanceof Error ? error.message : "Unable to start GitHub OAuth",
      400
    );
  }
}
