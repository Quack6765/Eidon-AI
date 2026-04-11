import { requireAdminUser } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { callProviderText } from "@/lib/provider";
import {
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";

export async function POST(request: Request) {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      providerProfileId?: string;
    };
    const settings =
      (body.providerProfileId ? getProviderProfileWithApiKey(body.providerProfileId) : null) ??
      getDefaultProviderProfileWithApiKey();

    if (!settings) {
      return badRequest("Provider profile not found");
    }

    if (settings.providerKind === "openai_compatible" && !settings.apiKey) {
      return badRequest("Set an API key before running a connection test");
    }

    if (
      settings.providerKind === "github_copilot" &&
      !settings.githubUserAccessTokenEncrypted
    ) {
      return badRequest("Connect a GitHub account before running a Copilot connection test");
    }

    const text = await callProviderText({
      settings,
      prompt: "Reply with the single word connected.",
      purpose: "test"
    });

    return ok({ success: true, text });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Connection test failed", 502);
  }
}
