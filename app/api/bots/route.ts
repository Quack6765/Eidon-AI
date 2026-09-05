import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createBot, ensureChiefBot, listBots, toBotSummary, MAX_BOTS_PER_USER } from "@/lib/bots";
import { broadcastBotUpsert, listRecentBotRuns } from "@/lib/bot-runs";
import { badRequest, ok } from "@/lib/http";
import { getTurnActivity } from "@/lib/turn-activity";
import type { TurnActivity } from "@/lib/types";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  title: z.string().trim().max(120).default(""),
  description: z.string().trim().max(1000).default(""),
  systemPrompt: z.string().trim().max(8000).optional()
});

export async function GET() {
  const user = await requireUser();
  ensureChiefBot(user.id);
  const bots = listBots(user.id).map(toBotSummary);
  const runs = listRecentBotRuns({ userId: user.id, limit: 20 });
  const activities: Record<string, TurnActivity> = {};
  for (const bot of bots) {
    const activity = getTurnActivity(bot.homeConversationId);
    if (activity) activities[bot.homeConversationId] = activity;
  }
  return ok({ bots, runs, activities, limits: { maxBots: MAX_BOTS_PER_USER } });
}

export async function POST(request: Request) {
  const user = await requireUser();
  const body = createSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid bot data");
  }

  try {
    const bot = createBot(body.data, user.id);
    broadcastBotUpsert(bot);
    return ok({ bot: toBotSummary(bot) }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid bot data");
  }
}
