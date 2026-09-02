import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteBot, getBot, toBotSummary, updateBot } from "@/lib/bots";
import { broadcastBotDeleted, broadcastBotUpsert, listRecentBotRuns } from "@/lib/bot-runs";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1)
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  systemPrompt: z.string().trim().max(8000).optional()
}).refine(
  (value) => Object.keys(value).length > 0,
  "Invalid bot update"
);

export async function GET(
  _request: Request,
  context: { params: Promise<{ botId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "bot id");
  if (params instanceof NextResponse) return params;

  const bot = getBot(params.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  const runs = listRecentBotRuns({ userId: user.id, limit: 20 }).filter(
    (run) => run.botId === bot.id
  );

  return ok({ bot: toBotSummary(bot), runs });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ botId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "bot id");
  if (params instanceof NextResponse) return params;

  const body = updateSchema.safeParse(await request.json());
  if (!body.success) {
    return badRequest("Invalid bot update");
  }

  try {
    const updated = updateBot(params.botId, body.data, user.id);
    if (!updated) {
      return badRequest("Bot not found", 404);
    }
    broadcastBotUpsert(updated);
    return ok({ bot: toBotSummary(updated) });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid bot update");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ botId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "bot id");
  if (params instanceof NextResponse) return params;

  const bot = getBot(params.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  try {
    const deleted = deleteBot(params.botId, user.id);
    if (!deleted) {
      return badRequest("Bot not found", 404);
    }
    broadcastBotDeleted(params.botId, user.id);
    return ok({ deleted: true });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Failed to delete bot");
  }
}
