import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { callProviderText } from "@/lib/provider";
import {
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";

export async function POST(request: Request) {
  await requireUser();

  try {
    const body = (await request.json().catch(() => ({}))) as {
      providerProfileId?: string;
    };
    const settings =
      (body.providerProfileId ? getProviderProfileWithApiKey(body.providerProfileId) : null) ??
      getDefaultProviderProfileWithApiKey();

    if (!settings?.apiKey) {
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
