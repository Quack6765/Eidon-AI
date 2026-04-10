import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/auth";
import { badRequest, forbidden } from "@/lib/http";
import type { AuthUser } from "@/lib/types";
import { exchangeGithubCodeForTokens, verifyGithubOauthState } from "@/lib/github-copilot";
import { updateGithubCopilotCredentials } from "@/lib/settings";

export async function GET(request: Request) {
  let user: AuthUser;
  try {
    user = await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return badRequest("Missing code or state parameter");
  }

  let claims: { profileId: string; userId: string };
  try {
    claims = await verifyGithubOauthState(state);
  } catch {
    return badRequest("Invalid or expired OAuth state");
  }

  if (claims.userId !== user.id) {
    return badRequest("OAuth state user mismatch");
  }

  try {
    const tokens = await exchangeGithubCodeForTokens(code);

    if (tokens.error) {
      return badRequest(`GitHub OAuth error: ${tokens.error_description ?? tokens.error}`);
    }

    if (!tokens.access_token) {
      return badRequest("GitHub OAuth did not return an access token");
    }

    updateGithubCopilotCredentials(claims.profileId, {
      githubUserAccessToken: tokens.access_token!,
      githubRefreshToken: tokens.refresh_token ?? "",
      githubTokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAccountName: null
    });
  } catch (error) {
    return badRequest(`Token exchange failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  redirect("/settings/providers");
}
