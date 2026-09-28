import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationBrowserTarget, getComputerState } from "@/lib/agent-computer-relay";
import { requireUser } from "@/lib/auth";
import { getConversation } from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  conversationId: z.string().min(1)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;

  if (!getConversation(params.conversationId, user.id)) {
    return badRequest("Conversation not found", 404);
  }

  const { type: _type, ...computer } = getComputerState(conversationBrowserTarget(params.conversationId));
  return ok({ computer });
}
