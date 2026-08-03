import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";
import {
  clearProviderConnection,
  getProviderProfile,
  getRuntimeProviderProfile,
  updateProviderConnection
} from "@/lib/provider-profiles";
import { getProviderConnectionSummary } from "@/lib/provider-profile";
import { getProviderConnectionMode } from "@/lib/provider-adapters";

const paramsSchema = z.object({ profileId: z.string().min(1) });
const bodySchema = z.object({ credential: z.string().min(1) });

export async function PUT(
  request: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();
  const params = await parseRouteParams(context, paramsSchema, "provider profile");
  if (params instanceof Response) return params;
  const profile = getProviderProfile(params.profileId);
  if (!profile) return badRequest("Provider profile not found", 404);
  if (getProviderConnectionMode(profile.providerKind) === "oauth") {
    return badRequest("This provider uses an OAuth connection flow");
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("A credential is required");
  updateProviderConnection(profile.id, { credentials: { apiKey: body.data.credential } });
  const runtimeProfile = getRuntimeProviderProfile(profile.id)!;
  return ok({ connection: getProviderConnectionSummary(runtimeProfile) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();
  const params = await parseRouteParams(context, paramsSchema, "provider profile");
  if (params instanceof Response) return params;
  return clearProviderConnection(params.profileId)
    ? ok({ success: true })
    : badRequest("Provider profile not found", 404);
}
