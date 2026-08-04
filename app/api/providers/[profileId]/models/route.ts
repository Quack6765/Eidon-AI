import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";
import { getProviderAdapter, getProviderReadinessError } from "@/lib/provider-adapters";
import { getRuntimeProviderProfile } from "@/lib/provider-profiles";

const paramsSchema = z.object({ profileId: z.string().min(1) });

export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();
  const params = await parseRouteParams(context, paramsSchema, "provider profile");
  if (params instanceof Response) return params;
  const profile = getRuntimeProviderProfile(params.profileId);
  if (!profile) return badRequest("Provider profile not found", 404);
  const readinessError = getProviderReadinessError(profile);
  if (readinessError) return badRequest(readinessError, 409);
  try {
    return ok({
      models: await getProviderAdapter(profile.providerKind).discoverModels(profile)
    });
  } catch (error) {
    console.error("[providers] Model discovery failed:", error);
    return badRequest("Unable to discover provider models", 502);
  }
}
