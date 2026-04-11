import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/auth";
import { badRequest, forbidden } from "@/lib/http";
import type { AuthUser } from "@/lib/types";
import { createGithubOauthState, getGithubAuthorizeUrl } from "@/lib/github-copilot";
import { getProviderProfile } from "@/lib/settings";

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
