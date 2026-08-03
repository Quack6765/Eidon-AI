import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { callProviderText } from "@/lib/provider";
import { getProviderReadinessError } from "@/lib/provider-adapters";
import {
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";

export async function POST(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

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

    const readinessError = getProviderReadinessError(settings);
    if (readinessError) return badRequest(readinessError);

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
