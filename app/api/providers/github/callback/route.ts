import { redirect } from "next/navigation";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden } from "@/lib/http";
import {
  exchangeGithubCodeForTokens,
  updateGithubCopilotConnectionIfNonceMatches,
  verifyGithubOauthState
} from "@/lib/github-copilot";
import { getProviderProfile } from "@/lib/provider-profiles";
import { handleMobileGithubOauthCallback } from "@/lib/mobile-github-oauth";

export async function GET(request: Request) {
  const mobileResponse = await handleMobileGithubOauthCallback(request);
  if (mobileResponse) return mobileResponse;

  const user = await requireAdminResponse();
  if (!user) return forbidden();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return badRequest("Missing code or state parameter");
  }

  let claims: { profileId: string; userId: string; profileNonce: string };
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

    const profile = getProviderProfile(claims.profileId);
    if (!profile || profile.providerKind !== "github_copilot") {
      return badRequest("GitHub Copilot is only available for Copilot profiles");
    }

    const updated = updateGithubCopilotConnectionIfNonceMatches(
      claims.profileId,
      claims.profileNonce,
      {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token ?? "",
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        refreshExpiresAt: null,
        accountLogin: null,
        accountName: null
      }
    );
    if (!updated) {
      return badRequest("GitHub Copilot profile changed before the connection completed");
    }
  } catch (error) {
    return badRequest(`Token exchange failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  redirect("/settings/providers");
}
