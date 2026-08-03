import { redirect } from "next/navigation";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden } from "@/lib/http";
import { createGithubOauthState, getGithubAuthorizeUrl } from "@/lib/github-copilot";
import { claimProviderConnectionAttempt, getProviderProfile } from "@/lib/provider-profiles";

export async function GET(request: Request) {
  const user = await requireAdminResponse();
  if (!user) return forbidden();

  const url = new URL(request.url);
  const providerProfileId = url.searchParams.get("providerProfileId");

  if (!providerProfileId) {
    return badRequest("Provider profile is required");
  }

  const profile = getProviderProfile(providerProfileId);

  if (!profile || profile.providerKind !== "github_copilot") {
    return badRequest("GitHub Copilot is only available for Copilot profiles");
  }

  const profileNonce = claimProviderConnectionAttempt(profile.id);
  if (!profileNonce) {
    return badRequest("GitHub Copilot profile changed before the connection started");
  }

  const state = await createGithubOauthState(profile.id, user.id, profileNonce);
  redirect(getGithubAuthorizeUrl(state));
}
