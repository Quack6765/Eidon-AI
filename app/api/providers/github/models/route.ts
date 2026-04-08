import { badRequest, ok } from "@/lib/http";
import { getGithubConnectionStatus, listGithubCopilotModels } from "@/lib/github-copilot";
import { getProviderProfileWithApiKey } from "@/lib/settings";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerProfileId = url.searchParams.get("providerProfileId");

  if (!providerProfileId) {
    return badRequest("Provider profile is required");
  }

  const profile = getProviderProfileWithApiKey(providerProfileId);

  if (!profile || profile.providerKind !== "github_copilot") {
    return badRequest("Profile not found or not a Copilot profile");
  }

  if (getGithubConnectionStatus(profile) !== "connected") {
    return badRequest("GitHub account not connected");
  }

  const modelList = await listGithubCopilotModels(profile);

  return ok({ models: modelList });
}
