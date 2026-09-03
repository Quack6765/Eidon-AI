import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { markBotPendingInputSeen, toBotSummary } from "@/lib/bots";
import { broadcastBotUpsert } from "@/lib/bot-runs";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ botId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "bot id");
  if (params instanceof NextResponse) return params;

  const bot = markBotPendingInputSeen(params.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  broadcastBotUpsert(bot);
  return ok({ bot: toBotSummary(bot) });
}
