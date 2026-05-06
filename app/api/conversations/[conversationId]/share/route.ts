import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  disableConversationShare,
  enableConversationShare,
  getConversationShare
} from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  conversationId: z.string().min(1)
});

const updateSchema = z.object({
  enabled: z.boolean()
});

function buildSharePayload(request: Request, share: { enabled: boolean; token: string | null }) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const origin = host
    ? `${forwardedProto || new URL(request.url).protocol.replace(":", "")}://${host}`
    : new URL(request.url).origin;
  const url = share.enabled && share.token ? `${origin}/share/${share.token}` : null;

  return {
    enabled: share.enabled,
    token: share.token,
    url
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  const share = getConversationShare(params.data.conversationId, user.id);

  if (!share) {
    return badRequest("Conversation not found", 404);
  }

  return ok(buildSharePayload(request, share));
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  const body = updateSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid share update");
  }

  const share = body.data.enabled
    ? enableConversationShare(params.data.conversationId, user.id)
    : disableConversationShare(params.data.conversationId, user.id);

  if (!share) {
    return badRequest("Conversation not found", 404);
  }

  return ok(buildSharePayload(request, share));
}
