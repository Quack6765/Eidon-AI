import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  disableConversationShare,
  enableConversationShare,
  getConversationShare
} from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { getRequestOrigin } from "@/lib/request-url";

const paramsSchema = z.object({
  conversationId: z.string().min(1)
});

const updateSchema = z.object({
  enabled: z.boolean()
});

function buildSharePayload(request: Request, share: { enabled: boolean; token: string | null }) {
  const origin = getRequestOrigin(request);
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
    const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;

  const share = getConversationShare(params.conversationId, user.id);

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
    const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;

  const body = updateSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid share update");
  }

  const share = body.data.enabled
    ? enableConversationShare(params.conversationId, user.id)
    : disableConversationShare(params.conversationId, user.id);

  if (!share) {
    return badRequest("Conversation not found", 404);
  }

  return ok(buildSharePayload(request, share));
}
