import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import {
  buildSkillMarkdown,
  ensureLibraryReady,
  findLibrarySkill,
  hardDeleteLibrarySkill,
  normalizeSkillDisplayName,
  resolveLibrarySkill,
  rewriteLibrarySkill
} from "@/lib/skill-library";
import { assertEssentialGuard, assertPinnedGuard, buildGuardTarget } from "@/lib/skill-guards";
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

  const ownerUserId = bot.userId ?? null;
  ensureLibraryReady(ownerUserId);

  const existing = resolveLibrarySkill(ownerUserId, params.skillId);
  if (!existing) {
    return badRequest("Skill not found", 404);
  }

  const body = updateSchema.safeParse(await request.json());
  if (!body.success) {
    return badRequest("Invalid skill data");
  }

  const metadata = parseSkillContentMetadata(existing.skill.content);

  if (body.data.name !== undefined) {
    const requested = normalizeSkillDisplayName(body.data.name);
    if (!requested) {
      return badRequest("Use letters, numbers, hyphens, dots, or underscores for the skill name.");
    }
    if (requested !== existing.ref) {
      return badRequest(
        "Renaming a skill is not supported — its directory is its identity. Create a new skill and delete this one instead."
      );
    }
  }

  const content = buildSkillMarkdown(
    existing.skill.name,
    body.data.description ?? metadata.description ?? existing.skill.description,
    body.data.instructions ?? stripSkillFrontmatter(existing.skill.content).trim()
  );

  const result = rewriteLibrarySkill(ownerUserId, existing.ref, { content, actor: "user" });
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

  const ownerUserId = bot.userId ?? null;
  ensureLibraryReady(ownerUserId);

  const existing = resolveLibrarySkill(ownerUserId, params.skillId);
  if (!existing) {
    return badRequest("Skill not found", 404);
  }

  const target = buildGuardTarget(ownerUserId, existing.ref, existing.skill.name);
  const pinned = assertPinnedGuard(target, "delete");
  if (!pinned.ok) {
    return badRequest(pinned.error);
  }
  const essential = assertEssentialGuard(target, "delete");
  if (!essential.ok) {
    return badRequest(essential.error);
  }

  const result = hardDeleteLibrarySkill(ownerUserId, existing.ref, "user");
  if ("error" in result) {
    return badRequest(result.error);
  }

  return ok({ success: true });
}
