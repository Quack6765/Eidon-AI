import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { callProviderText } from "@/lib/provider";
import { getSettingsWithApiKey } from "@/lib/settings";

export async function POST() {
  await requireUser();

  try {
    const settings = getSettingsWithApiKey();

    if (!settings.apiKey) {
      return badRequest("Set an API key before running a connection test");
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
