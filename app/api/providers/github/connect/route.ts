import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { badRequest } from "@/lib/http";
import { createGithubOauthState, getGithubAuthorizeUrl } from "@/lib/github-copilot";
import { getProviderProfile } from "@/lib/settings";

export async function GET(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const providerProfileId = url.searchParams.get("providerProfileId");

  if (!providerProfileId) {
    return badRequest("Provider profile is required");
  }

  const profile = getProviderProfile(providerProfileId);

  if (!profile || profile.providerKind !== "github_copilot") {
    return badRequest("GitHub Copilot is only available for Copilot profiles");
  }

  const state = await createGithubOauthState(profile.id, user.id);
  redirect(getGithubAuthorizeUrl(state));
}
