import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { listBotWorkspaceSkills, saveBotWorkspaceSkill } from "@/lib/bot-workspace-skills";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1)
});

const createSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  instructions: z.string().trim().min(1)
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

  return ok({ skills: listBotWorkspaceSkills(bot) });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ botId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "bot id");
  if (params instanceof NextResponse) return params;

  const bot = getBot(params.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  const body = createSchema.safeParse(await request.json());
  if (!body.success) {
    return badRequest("Invalid skill data");
  }

  const result = saveBotWorkspaceSkill(bot, body.data);
  if ("error" in result) {
    return badRequest(result.error);
  }

  return ok({ skill: result.skill }, { status: 201 });
}
