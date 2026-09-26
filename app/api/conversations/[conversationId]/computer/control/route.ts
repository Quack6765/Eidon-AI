import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationBrowserTarget, getComputerState } from "@/lib/agent-computer-relay";
import { requireUser } from "@/lib/auth";
import { returnComputerControl, takeComputerControl } from "@/lib/computer-handoff";
import { getConversation } from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  conversationId: z.string().min(1)
});

const bodySchema = z.object({
  action: z.enum(["take", "return"]),
  note: z.string().max(1_000).optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;

  if (!getConversation(params.conversationId, user.id)) {
    return badRequest("Conversation not found", 404);
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return badRequest("Invalid control request");
  }

  if (body.data.action === "take") takeComputerControl(params.conversationId);
  else returnComputerControl(params.conversationId, body.data.note);

  const { type: _type, ...computer } = getComputerState(conversationBrowserTarget(params.conversationId));
  return ok({ computer });
}
