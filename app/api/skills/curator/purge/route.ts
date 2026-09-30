import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { ensureLibraryReady, listArchivedSkills } from "@/lib/skill-library";
import { getCuratorConfig, purgeArchived, updateCuratorConfig } from "@/lib/skill-curator";
import { badRequest, ok } from "@/lib/http";

const bodySchema = z.object({
  botId: z.string().min(1),
  archiveTtlDays: z.number().int().min(0).optional()
});

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid purge request");
  }

  const bot = getBot(parsed.data.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  const ownerUserId = bot.userId ?? null;
  ensureLibraryReady(ownerUserId);

  const config =
    parsed.data.archiveTtlDays === undefined
      ? getCuratorConfig()
      : updateCuratorConfig({ archiveTtlDays: parsed.data.archiveTtlDays });

  if (config.archiveTtlDays <= 0) {
    return badRequest("Set archiveTtlDays above 0 to enable purging archived skills.");
  }

  const purged = purgeArchived(ownerUserId, config);
  return ok({ purged, archived: listArchivedSkills(ownerUserId) });
}
