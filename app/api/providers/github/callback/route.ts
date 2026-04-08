import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { badRequest } from "@/lib/http";
import { exchangeGithubCodeForTokens, verifyGithubOauthState } from "@/lib/github-copilot";
import { updateGithubCopilotCredentials } from "@/lib/settings";

export async function GET(request: Request) {
  const user = await requireUser();
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

    updateGithubCopilotCredentials(claims.profileId, {
      githubUserAccessToken: tokens.access_token,
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

  redirect("/settings?tab=providers");
}
