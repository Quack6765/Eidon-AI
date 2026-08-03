import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";
import { getProviderAdapter } from "@/lib/provider-adapters";
import { getProviderProfile } from "@/lib/provider-profiles";

const paramsSchema = z.object({
  profileId: z.string().min(1),
  flowId: z.string().min(1)
});

async function getAuthorizedFlow(context: { params: Promise<{ profileId: string; flowId: string }> }) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();
  const params = await parseRouteParams(context, paramsSchema, "provider connection flow");
  if (params instanceof Response) return params;
  const profile = getProviderProfile(params.profileId);
  if (!profile) return badRequest("Provider profile not found", 404);
  const connectionFlows = getProviderAdapter(profile.providerKind).connectionFlows;
  if (!connectionFlows) return badRequest("This provider does not support connection flows");
  const flow = connectionFlows.get(params.flowId, admin.id);
  if (!flow || flow.profileId !== params.profileId) return badRequest("Connection flow not found", 404);
  return { admin, params, flow, connectionFlows };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string; flowId: string }> }
) {
  const result = await getAuthorizedFlow(context);
  return result instanceof Response ? result : ok({ flow: result.flow });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ profileId: string; flowId: string }> }
) {
  const result = await getAuthorizedFlow(context);
  if (result instanceof Response) return result;
  return result.connectionFlows.cancel(result.params.flowId, result.admin.id)
    ? ok({ success: true })
    : badRequest("Connection flow cannot be canceled", 409);
}
