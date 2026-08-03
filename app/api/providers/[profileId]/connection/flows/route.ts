import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";
import { getProviderAdapter } from "@/lib/provider-adapters";
import { getProviderProfile } from "@/lib/provider-profiles";

const paramsSchema = z.object({ profileId: z.string().min(1) });

export async function POST(
  _request: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();
  const params = await parseRouteParams(context, paramsSchema, "provider profile");
  if (params instanceof Response) return params;
  const profile = getProviderProfile(params.profileId);
  if (!profile) return badRequest("Provider profile not found", 404);
  const connectionFlows = getProviderAdapter(profile.providerKind).connectionFlows;
  if (!connectionFlows) {
    return badRequest("This provider does not support connection flows");
  }
  try {
    return ok(await connectionFlows.create(admin, profile.id), { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to start connection flow");
  }
}
