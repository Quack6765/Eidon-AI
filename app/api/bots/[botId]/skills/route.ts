import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import {
  buildSkillMarkdown,
  createLibrarySkill,
  ensureLibraryReady,
  findLibrarySkill,
  listLibrarySkills,
  normalizeSkillDisplayName
} from "@/lib/skill-library";
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

  const ownerUserId = bot.userId ?? null;
  ensureLibraryReady(ownerUserId);

  return ok({ skills: listLibrarySkills(ownerUserId, { includeArchived: true }) });
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

  const ownerUserId = bot.userId ?? null;
  ensureLibraryReady(ownerUserId);

  const name = normalizeSkillDisplayName(body.data.name);
  if (!name) {
    return badRequest("Use letters, numbers, hyphens, dots, or underscores for the skill name.");
  }

  const content = buildSkillMarkdown(body.data.name.trim(), body.data.description, body.data.instructions);
  const result = createLibrarySkill(ownerUserId, {
    name,
    content,
    actor: "user",
    agentAuthored: false
  });

  if ("error" in result) {
    return badRequest(result.error);
  }

  return ok({ skill: result.skill }, { status: 201 });
}
