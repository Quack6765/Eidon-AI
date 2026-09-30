import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { ensureLibraryReady, listSnapshots, restoreLibrarySnapshot } from "@/lib/skill-library";
import { badRequest, ok } from "@/lib/http";

const bodySchema = z.object({
  botId: z.string().min(1),
  snapshot: z.string().min(1)
});

export async function GET(request: Request) {
  const user = await requireUser();
  const botId = new URL(request.url).searchParams.get("botId");
  if (!botId) {
    return badRequest("botId is required");
  }

  const bot = getBot(botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  return ok({ snapshots: listSnapshots(bot.userId ?? null) });
}

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid rollback request");
  }

  const bot = getBot(parsed.data.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  const ownerUserId = bot.userId ?? null;
  ensureLibraryReady(ownerUserId);

  const result = restoreLibrarySnapshot(ownerUserId, parsed.data.snapshot);
  if ("error" in result) {
    return badRequest(result.error);
  }

  return ok({ restored: result.restored, snapshots: listSnapshots(ownerUserId) });
}
