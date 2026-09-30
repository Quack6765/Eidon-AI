import { getChiefBot, listBots } from "@/lib/bots";
import {
  getCuratorConfig,
  readCuratorState,
  runCuratorPass,
  seedCuratorState,
  shouldRunCurator,
  type SkillCuratorConfig
} from "@/lib/skill-curator";
import { ensureLibraryReady } from "@/lib/skill-library";
import type { Bot } from "@/lib/types";

const SCHEDULER_KEY = Symbol.for("eidon:skill-maintenance-scheduler");
const TICK_MS = 60 * 60 * 1000;

export function listSkillOwnerIds(): string[] {
  return [...new Set(listBots().map((bot) => bot.userId ?? ""))].filter((value) => value !== "");
}

export async function runConsolidationFork(
  ownerUserId: string,
  bot: Bot,
  config: SkillCuratorConfig
): Promise<string | null> {
  if (!config.consolidate) {
    return null;
  }

  ensureLibraryReady(ownerUserId);
  const [{ buildCuratorConsolidationPrompt, buildSkillCatalog, runSkillReviewPass }, { startChatTurn }, { getConversationManager }] =
    await Promise.all([import("@/lib/skill-review"), import("@/lib/chat-turn"), import("@/lib/ws-singleton")]);

  const prompt = buildCuratorConsolidationPrompt(buildSkillCatalog(ownerUserId));

  return runSkillReviewPass({
    bot,
    sourceConversationId: bot.homeConversationId,
    sourceAssistantMessageId: null,
    prompt,
    manager: getConversationManager(),
    startChatTurn: startChatTurn as never
  });
}

export async function runSkillMaintenanceForOwner(
  ownerUserId: string,
  options: { dryRun?: boolean; force?: boolean; bot?: Bot } = {}
): Promise<{ ran: boolean; summary: string | null; reason?: string }> {
  const config = getCuratorConfig();
  const state = readCuratorState(ownerUserId);

  if (!options.force) {
    const verdict = shouldRunCurator(state, config, new Date(), state.lastInteractionAt);
    if (!verdict.run) {
      return { ran: false, summary: null, reason: verdict.reason };
    }
  }

  ensureLibraryReady(ownerUserId);
  const result = runCuratorPass(ownerUserId, config, { dryRun: options.dryRun === true });

  let consolidation: string | null = null;
  if (config.consolidate && !options.dryRun) {
    const bot = options.bot ?? getChiefBot(ownerUserId);
    if (bot) {
      consolidation = await runConsolidationFork(ownerUserId, bot, config);
    }
  }

  return {
    ran: true,
    summary: consolidation ? `${result.summary}\n${consolidation}` : result.summary
  };
}

export async function tickSkillMaintenance(): Promise<number> {
  let ran = 0;

  for (const ownerUserId of listSkillOwnerIds()) {
    try {
      const outcome = await runSkillMaintenanceForOwner(ownerUserId);
      if (outcome.ran) {
        ran += 1;
      }
    } catch (error) {
      console.error("Skill maintenance failed for owner", ownerUserId, error);
    }
  }

  return ran;
}

export function ensureSkillMaintenanceScheduler() {
  const global = globalThis as Record<symbol, unknown>;
  if (global[SCHEDULER_KEY]) {
    return global[SCHEDULER_KEY] as { stop: () => void };
  }

  try {
    for (const ownerUserId of listSkillOwnerIds()) {
      seedCuratorState(ownerUserId);
    }
  } catch {
    // No database yet — the first tick will seed.
  }

  const timer = setInterval(() => {
    void tickSkillMaintenance();
  }, TICK_MS);

  timer.unref?.();

  const handle = {
    stop() {
      clearInterval(timer);
      delete global[SCHEDULER_KEY];
    }
  };
  global[SCHEDULER_KEY] = handle;
  return handle;
}
