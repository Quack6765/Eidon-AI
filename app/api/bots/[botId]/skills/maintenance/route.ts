import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { ensureLibraryReady, findLibrarySkill, listArchivedSkills, resolveArchivedName, restoreLibrarySkill } from "@/lib/skill-library";
import {
  getCuratorConfig,
  readCuratorState,
  setCuratorPaused
} from "@/lib/skill-curator";
import { runSkillMaintenanceForOwner } from "@/lib/skill-maintenance";
import { adoptSkill, setPinned } from "@/lib/skill-usage";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1)
});

const maintenanceSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("pin"), ref: z.string().min(1) }),
  z.object({ op: z.literal("unpin"), ref: z.string().min(1) }),
  z.object({ op: z.literal("adopt"), ref: z.string().min(1) }),
  z.object({ op: z.literal("restore"), archivedName: z.string().min(1) }),
  z.object({ op: z.literal("pause") }),
  z.object({ op: z.literal("resume") }),
  z.object({ op: z.literal("run"), dryRun: z.boolean().optional() })
]);

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

  const parsed = maintenanceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid maintenance request");
  }

  const ownerUserId = bot.userId ?? user.id;
  ensureLibraryReady(ownerUserId);
  const body = parsed.data;

  switch (body.op) {
    case "pin":
    case "unpin": {
      const found = findLibrarySkill(ownerUserId, body.ref);
      if (!found) {
        return badRequest("Skill not found", 404);
      }
      setPinned(ownerUserId, found.ref, body.op === "pin");
      return ok({ ref: found.ref, pinned: body.op === "pin" });
    }

    case "adopt": {
      const found = findLibrarySkill(ownerUserId, body.ref);
      if (!found) {
        return badRequest("Skill not found", 404);
      }
      adoptSkill(ownerUserId, found.ref);
      return ok({ ref: found.ref, adopted: true });
    }

    case "restore": {
      const archivedName = resolveArchivedName(ownerUserId, body.archivedName);
      if (!archivedName) {
        return badRequest(`No archived skill named '${body.archivedName}'.`, 404);
      }
      const result = restoreLibrarySkill(ownerUserId, archivedName);
      if ("error" in result) {
        return badRequest(result.error);
      }
      return ok({ ref: result.ref, archived: listArchivedSkills(ownerUserId) });
    }

    case "pause":
    case "resume": {
      const state = setCuratorPaused(ownerUserId, body.op === "pause");
      return ok({ paused: state.paused });
    }

    default: {
      const outcome = await runSkillMaintenanceForOwner(ownerUserId, {
        dryRun: body.dryRun === true,
        force: true
      });
      return ok({ ...outcome, config: getCuratorConfig(), archived: listArchivedSkills(ownerUserId) });
    }
  }
}

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

  const ownerUserId = bot.userId ?? user.id;
  ensureLibraryReady(ownerUserId);

  return ok({
    config: getCuratorConfig(),
    state: readCuratorState(ownerUserId),
    archived: listArchivedSkills(ownerUserId)
  });
}
