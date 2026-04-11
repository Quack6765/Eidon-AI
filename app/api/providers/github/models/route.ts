import { requireAdminUser } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { getGithubConnectionStatus, listGithubCopilotModels } from "@/lib/github-copilot";
import { getProviderProfileWithApiKey } from "@/lib/settings";

export async function GET(request: Request) {
  try {
    await requireAdminUser();
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

  const profile = getProviderProfileWithApiKey(providerProfileId);

  if (!profile || profile.providerKind !== "github_copilot") {
    return badRequest("Profile not found or not a Copilot profile");
  }

  if (getGithubConnectionStatus(profile) !== "connected") {
    return badRequest("GitHub account not connected");
  }

  try {
    const modelList = await listGithubCopilotModels(profile);

    return ok({
      models: modelList.map((model) => ({
        id: model.id,
        name: model.name,
        maxContextWindowTokens: model.capabilities?.limits?.max_context_window_tokens ?? null
      }))
    });
  } catch (error) {
    console.error("[copilot/models] Failed to list models:", error instanceof Error ? error.message : error);
    return ok({ models: [] });
  }
}
