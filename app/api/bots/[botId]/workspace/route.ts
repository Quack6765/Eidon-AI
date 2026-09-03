import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { listBotWorkspaceTree } from "@/lib/bot-sandbox";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1)
});

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

  return ok({ tree: listBotWorkspaceTree(bot) });
}
