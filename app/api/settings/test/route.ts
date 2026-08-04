import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { callProviderText } from "@/lib/provider";
import { getProviderReadinessError } from "@/lib/provider-adapters";
import {
  getDefaultRuntimeProviderProfile,
  getRuntimeProviderProfile
} from "@/lib/settings";

export async function POST(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  try {
    const body = (await request.json().catch(() => ({}))) as {
      providerProfileId?: string;
    };
    const settings =
      (body.providerProfileId ? getRuntimeProviderProfile(body.providerProfileId) : null) ??
      getDefaultRuntimeProviderProfile();

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
