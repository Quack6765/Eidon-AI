import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { getBotRun, stopBotRun } from "@/lib/bot-runs";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1),
  runId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ botId: string; runId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "bot run");
  if (params instanceof NextResponse) return params;

  const bot = getBot(params.botId, user.id);
  const run = bot ? getBotRun(params.runId) : null;
  if (!bot || !run || (run.botId !== bot.id && run.requestedByBotId !== bot.id)) {
    return badRequest("Bot run not found", 404);
  }

  return ok({ run: stopBotRun(run.id) ?? run });
}
