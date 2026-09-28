import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import {
  deleteBotWorkspaceSkill,
  getBotWorkspaceSkill,
  parseBotWorkspaceSkillId,
  saveBotWorkspaceSkill
} from "@/lib/bot-workspace-skills";
import { parseSkillContentMetadata, stripSkillFrontmatter } from "@/lib/skill-metadata";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1),
  skillId: z.string().min(1)
});

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  instructions: z.string().trim().min(1).optional()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ botId: string; skillId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "skill id");
  if (params instanceof NextResponse) return params;

  const bot = getBot(params.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  if (!parseBotWorkspaceSkillId(bot, params.skillId)) {
    return badRequest("Skill not found", 404);
  }

  const existing = getBotWorkspaceSkill(bot, params.skillId);
  if (!existing) {
    return badRequest("Skill not found", 404);
  }

  const body = updateSchema.safeParse(await request.json());
  if (!body.success) {
    return badRequest("Invalid skill data");
  }

  const metadata = parseSkillContentMetadata(existing.content);
  const result = saveBotWorkspaceSkill(
    bot,
    {
      name: body.data.name ?? metadata.name ?? existing.name,
      description: body.data.description ?? metadata.description ?? existing.description,
      instructions: body.data.instructions ?? stripSkillFrontmatter(existing.content).trim()
    },
    params.skillId
  );
  if ("error" in result) {
    return badRequest(result.error);
  }

  return ok({ skill: result.skill });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ botId: string; skillId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "skill id");
  if (params instanceof NextResponse) return params;

  const bot = getBot(params.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  if (!deleteBotWorkspaceSkill(bot, params.skillId)) {
    return badRequest("Skill not found", 404);
  }

  return ok({ success: true });
}
