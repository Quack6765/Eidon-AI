import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { ensureLibraryReady, readLedger } from "@/lib/skill-library";
import { badRequest, ok } from "@/lib/http";

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

  const ownerUserId = bot.userId ?? null;
  ensureLibraryReady(ownerUserId);

  return ok({ ledger: readLedger(ownerUserId) });
}
