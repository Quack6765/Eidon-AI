import { randomInt } from "node:crypto";

import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import {
  clearConversationContent,
  createConversation,
  deleteConversation,
  getConversation,
  renameConversation,
  updateConversationProviderProfile
} from "@/lib/conversations";
import { claimChatTurnStart, releaseChatTurnStart, requestStop } from "@/lib/chat-turn-control";
import { getProviderProfile } from "@/lib/settings";
import { getConversationManager } from "@/lib/ws-singleton";
import { nowIso } from "@/lib/utils";
import { ensureBotWorkspace, removeBotBrowserSession, removeBotWorkspace } from "@/lib/bot-sandbox";
import { DEFAULT_BOT_BASE_SYSTEM_PROMPT } from "@/lib/bot-prompt-defaults";
import { deleteBotAvatarSvg } from "@/lib/bot-avatar-store";
import type { Bot, BotStatus, BotSummary } from "@/lib/types";

export { DEFAULT_BOT_BASE_SYSTEM_PROMPT };

export const MAX_BOTS_PER_USER = 25;
export const CHIEF_BOT_NAME = "Chief of Staff";

type BotRow = {
  id: string;
  user_id: string | null;
  name: string;
  title: string;
  description: string;
  avatar_seed: string;
  system_prompt: string;
  is_chief: number;
  home_conversation_id: string;
  pending_input_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

const BOT_COLUMNS = `id, user_id, name, title, description, avatar_seed, system_prompt, is_chief, home_conversation_id, pending_input_seen_at, created_at, updated_at`;

function rowToBot(row: BotRow): Bot {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    title: row.title,
    description: row.description,
    avatarSeed: row.avatar_seed,
    systemPrompt: row.system_prompt,
    isChief: row.is_chief === 1,
    homeConversationId: row.home_conversation_id,
    pendingInputSeenAt: row.pending_input_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listBots(userId?: string): Bot[] {
  const rows = (userId
    ? getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE user_id = ? ORDER BY is_chief DESC, created_at ASC`).all(userId)
    : getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots ORDER BY is_chief DESC, created_at ASC`).all()) as BotRow[];
  return rows.map(rowToBot);
}

export function getBot(botId: string, userId?: string): Bot | null {
  const row = (userId
    ? getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE id = ? AND user_id = ?`).get(botId, userId)
    : getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE id = ?`).get(botId)) as BotRow | undefined;
  return row ? rowToBot(row) : null;
}

export function getBotByConversationId(conversationId: string): Bot | null {
  const row = getDb()
    .prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE home_conversation_id = ?`)
    .get(conversationId) as BotRow | undefined;
  return row ? rowToBot(row) : null;
}

export function getChiefBot(userId?: string): Bot | null {
  const row = (userId
    ? getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE user_id = ? AND is_chief = 1`).get(userId)
    : getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE is_chief = 1`).get()) as BotRow | undefined;
  return row ? rowToBot(row) : null;
}

function findBotByName(name: string, userId?: string): Bot | null {
  const row = (userId
    ? getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE user_id = ? AND lower(name) = lower(?)`)
        .get(userId, name)
    : getDb().prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE lower(name) = lower(?)`).get(name)) as
    | BotRow
    | undefined;
  return row ? rowToBot(row) : null;
}

export function resolveBotByNameOrId(reference: string, userId?: string): Bot | null {
  const trimmed = reference.trim();
  if (!trimmed) return null;
  return getBot(trimmed, userId) ?? findBotByName(trimmed, userId);
}

export type BotRosterEntry = { name: string; title: string; description: string; isChief: boolean };

function rosterLine(entry: BotRosterEntry) {
  return `- ${entry.name}${entry.isChief ? " — chief of staff" : ""}${entry.title ? ` (${entry.title})` : ""}${entry.description ? `: ${entry.description}` : ""}`;
}

export function buildBotRoster(userId?: string, excludeBotId?: string): BotRosterEntry[] {
  return listBots(userId)
    .filter((bot) => bot.id !== excludeBotId)
    .map((bot) => ({ name: bot.name, title: bot.title, description: bot.description, isChief: bot.isChief }));
}

function buildWorkerIdentityBlock(bot: Bot) {
  if (bot.systemPrompt.trim()) return bot.systemPrompt.trim();
  return [
    `You are ${bot.name}${bot.title ? `, ${bot.title}` : ""}, a specialist bot on the user's team.`,
    bot.description ? `Your role: ${bot.description}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWorkerCommunicationBlock(bot: Bot) {
  const roster = buildBotRoster(bot.userId ?? undefined, bot.id);
  const rosterLines = roster.length
    ? ["Your team — every member can be reached with message_bot:", ...roster.map(rosterLine)]
    : ["You currently have no other bots on your team. If a teammate is needed, tell the user to ask the chief of staff."];

  return [
    "Communicating with other bots:",
    "- Send a message to any other bot on the team, including the chief of staff, with message_bot. It returns immediately — the other bot works on it in the background and its reply arrives in your conversation as a new message.",
    "- When another bot messages you, answer normally in your regular response — your answer is delivered back to the sender automatically. Do not use message_bot to reply to a message; use it only to start a new exchange with another bot.",
    "- To see how a bot you messaged is doing, use check_bot instead of messaging it again.",
    "- Only the chief of staff can create or edit bots. If a job needs a new teammate or a changed role, message the chief of staff directly.",
    "",
    ...rosterLines
  ].join("\n");
}

function buildChiefPolicyBlock(bot: Bot) {
  const roster = buildBotRoster(bot.userId ?? undefined, bot.id);
  const rosterLines = roster.length
    ? ["Your team of specialist bots:", ...roster.map(rosterLine)]
    : ["You currently have no specialist bots. When a lane of recurring work emerges, propose creating a focused bot for it — with the user's confirmation."];

  return [
    `You are ${CHIEF_BOT_NAME}, the user's primary assistant coordinating a team of specialist bots.`,
    "",
    "How you work:",
    "- Answer directly for quick questions and small tasks you can handle yourself.",
    "- Delegate substantive or recurring work to the specialist bot that owns that area using message_bot. It returns immediately: after sending, tell the user right away what you asked and that you will let them know once you have the answer, then continue with other work. The bot's reply arrives here as a new message — report it to the user directly in this conversation when it lands.",
    "- You can message several bots at once; they work in parallel and each reply arrives as its own message whenever that bot finishes. Report each reply as it lands and keep track of which bots you are still waiting on.",
    "- To see how a bot is doing, use check_bot — it reports its status, elapsed time, current step, and output so far without interrupting it. Never message a bot just to ask for a status update.",
    "- Never use message_bot to acknowledge, confirm, or send a bot's reply back to it. Your answers in this conversation are for the user; bots already receive their instructions and their own replies. Only call message_bot to give a bot new instructions or ask it a new question.",
    "- When a bot's responsibilities change, update it with update_bot (rename it, or revise its title, description, or system prompt) instead of creating a duplicate.",
    "- Never message yourself.",
    "",
    "Creating a new bot is a significant, lasting decision — bias against it:",
    "- Propose a new bot only when all of these hold: the work is recurring (it will be needed multiple times), it deserves its own focused context and workspace (handling it yourself would clutter your own conversation), and no existing bot can own it.",
    "- Handle one-off tasks yourself, however large, and never propose a bot for work that will happen once or that is trivial for you.",
    "- Before calling create_bot, always propose the new bot to the user first — its name, title, what it would own, and why it meets this bar — and wait for their explicit confirmation in this conversation. If the user declines or is unsure, do not create it.",
    "",
    ...rosterLines,
    "",
    "Each bot has its own persistent browser session, file workspace, and private memory pool, and runs with the user's configured provider and settings."
  ].join("\n");
}

export function buildBotSystemPrompt(bot: Bot, basePrompt?: string) {
  const base = basePrompt?.trim() || DEFAULT_BOT_BASE_SYSTEM_PROMPT;
  if (bot.isChief) {
    return [base, buildChiefPolicyBlock(bot)].join("\n\n");
  }
  return [base, buildWorkerIdentityBlock(bot), buildWorkerCommunicationBlock(bot)].join("\n\n");
}

function countBots(userId?: string) {
  const row = (userId
    ? getDb().prepare("SELECT COUNT(*) as count FROM bots WHERE user_id = ?").get(userId)
    : getDb().prepare("SELECT COUNT(*) as count FROM bots").get()) as { count: number };
  return row.count;
}

const BOT_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generateBotId() {
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix += BOT_ID_ALPHABET[randomInt(BOT_ID_ALPHABET.length)];
  }
  return `bot-${suffix}`;
}

function nextBotId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = generateBotId();
    const existing = getDb().prepare("SELECT 1 FROM bots WHERE id = ?").get(id);
    if (!existing) {
      return id;
    }
  }
  throw new Error("Could not allocate a unique bot id");
}

function insertBot(input: {
  userId?: string;
  name: string;
  title: string;
  description: string;
  systemPrompt: string;
  isChief: boolean;
  homeConversationId: string;
}): Bot {
  const timestamp = nowIso();
  const bot: Bot = {
    id: nextBotId(),
    userId: input.userId ?? null,
    name: input.name,
    title: input.title,
    description: input.description,
    avatarSeed: createId("seed"),
    systemPrompt: input.systemPrompt,
    isChief: input.isChief,
    homeConversationId: input.homeConversationId,
    pendingInputSeenAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO bots (
        id, user_id, name, title, description, avatar_seed, system_prompt, is_chief, home_conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      bot.id,
      bot.userId,
      bot.name,
      bot.title,
      bot.description,
      bot.avatarSeed,
      bot.systemPrompt,
      bot.isChief ? 1 : 0,
      bot.homeConversationId,
      bot.createdAt,
      bot.updatedAt
    );

  return bot;
}

export function createBot(
  input: {
    name: string;
    title?: string;
    description?: string;
    systemPrompt?: string;
    isChief?: boolean;
  },
  userId?: string
): Bot {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Bot name is required");
  }
  if (name.length > 60) {
    throw new Error("Bot name must be 60 characters or fewer");
  }

  if (countBots(userId) >= MAX_BOTS_PER_USER) {
    throw new Error(`Bot limit reached (${MAX_BOTS_PER_USER})`);
  }

  const existing = findBotByName(name, userId);
  if (existing) {
    throw new Error(`A bot named "${existing.name}" already exists`);
  }

  const isChief = input.isChief ?? false;
  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";

  const createBotRecord = getDb().transaction(() => {
    const conversation = createConversation(name, null, { origin: "bot", providerProfileId: null }, userId ?? undefined);
    return insertBot({
      userId: userId ?? undefined,
      name,
      title,
      description,
      systemPrompt: input.systemPrompt?.trim() || "",
      isChief,
      homeConversationId: conversation.id
    });
  });

  const bot = createBotRecord.immediate();
  ensureBotWorkspace(bot);
  return bot;
}

export function ensureChiefBot(userId?: string): Bot {
  const existing = getChiefBot(userId ?? undefined);
  if (existing) return existing;
  return createBot(
    {
      name: CHIEF_BOT_NAME,
      title: "Coordinates your team of bots",
      description: "Answers directly or delegates work to specialist bots.",
      isChief: true
    },
    userId
  );
}

export function updateBot(
  botId: string,
  patch: {
    name?: string;
    title?: string;
    description?: string;
    systemPrompt?: string;
    providerProfileId?: string | null;
  },
  userId?: string
): Bot | null {
  const current = getBot(botId, userId);
  if (!current) return null;

  if (patch.providerProfileId !== undefined) {
    if (patch.providerProfileId !== null && !getProviderProfile(patch.providerProfileId)) {
      throw new Error("Provider profile not found");
    }
    updateConversationProviderProfile(current.homeConversationId, patch.providerProfileId, userId);
  }

  const nextName = patch.name?.trim();
  if (nextName !== undefined) {
    if (!nextName) throw new Error("Bot name is required");
    if (nextName.length > 60) throw new Error("Bot name must be 60 characters or fewer");
    const clash = findBotByName(nextName, userId);
    if (clash && clash.id !== current.id) {
      throw new Error(`A bot named "${clash.name}" already exists`);
    }
  }

  const updatedAt = nowIso();
  getDb()
    .prepare(
      `UPDATE bots
       SET name = ?, title = ?, description = ?, system_prompt = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      nextName ?? current.name,
      patch.title !== undefined ? patch.title.trim() : current.title,
      patch.description !== undefined ? patch.description.trim() : current.description,
      patch.systemPrompt !== undefined ? patch.systemPrompt.trim() : current.systemPrompt,
      updatedAt,
      botId
    );

  if (nextName !== undefined && nextName !== current.name) {
    renameConversation(current.homeConversationId, nextName);
    if (current.userId) {
      getConversationManager().broadcastAll(
        {
          type: "conversation_title_updated",
          conversationId: current.homeConversationId,
          title: nextName
        },
        current.userId
      );
    }
  }

  return getBot(botId, userId);
}

export function deleteBot(botId: string, userId?: string): boolean {
  const bot = getBot(botId, userId);
  if (!bot) return false;
  if (bot.isChief) {
    throw new Error("The chief of staff bot cannot be deleted");
  }

  const transaction = getDb().transaction(() => {
    getDb()
      .prepare("UPDATE automations SET enabled = 0, next_run_at = NULL, updated_at = ? WHERE bot_id = ?")
      .run(nowIso(), botId);
    getDb().prepare("DELETE FROM bots WHERE id = ?").run(botId);
    deleteBotAvatarSvg(bot.avatarSeed);
  });
  transaction();

  deleteConversation(bot.homeConversationId, userId ?? undefined);
  removeBotWorkspace(bot);
  void removeBotBrowserSession(bot).catch(() => {});

  void import("@/lib/automation-scheduler")
    .then(({ wakeAutomationSchedulers }) => wakeAutomationSchedulers())
    .catch(() => {});

  return true;
}

export class BotClearBusyError extends Error {
  constructor() {
    super("This bot is still finishing a run. Try again in a moment.");
    this.name = "BotClearBusyError";
  }
}

const CLEAR_CONTEXT_WAIT_POLL_MS = 100;
const CLEAR_CONTEXT_WAIT_TIMEOUT_MS = 8_000;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

async function stopQueuedBotRuns(bot: Bot) {
  const rows = getDb()
    .prepare("SELECT id FROM bot_runs WHERE bot_id = ? AND status = 'queued'")
    .all(bot.id) as Array<{ id: string }>;
  if (!rows.length) return;

  const { broadcastBotRunUpdate, updateBotRunStatus } = await import("@/lib/bot-runs");
  for (const row of rows) {
    const run = updateBotRunStatus(row.id, { status: "stopped", finishedAt: nowIso() });
    if (run) broadcastBotRunUpdate(run);
  }
}

async function claimTurnForClear(conversationId: string) {
  const deadline = Date.now() + CLEAR_CONTEXT_WAIT_TIMEOUT_MS;
  for (;;) {
    const claimed = claimChatTurnStart(conversationId);
    if (claimed.ok) return claimed.control;
    if (Date.now() >= deadline) return null;
    await delay(CLEAR_CONTEXT_WAIT_POLL_MS);
  }
}

export async function clearBotContext(botId: string, userId?: string): Promise<BotSummary> {
  const bot = getBot(botId, userId);
  if (!bot) throw new Error("Bot not found");

  await stopQueuedBotRuns(bot);

  const manager = getConversationManager();
  getDb().prepare("DELETE FROM queued_messages WHERE conversation_id = ?").run(bot.homeConversationId);
  manager.broadcast(bot.homeConversationId, {
    type: "queue_updated",
    conversationId: bot.homeConversationId,
    queuedMessages: []
  });

  requestStop(bot.homeConversationId);

  const control = await claimTurnForClear(bot.homeConversationId);
  if (!control) {
    throw new BotClearBusyError();
  }

  try {
    clearConversationContent(bot.homeConversationId);
    manager.broadcast(bot.homeConversationId, {
      type: "conversation_cleared",
      conversationId: bot.homeConversationId
    });
    manager.broadcast(bot.homeConversationId, {
      type: "conversation_activity",
      conversationId: bot.homeConversationId,
      isActive: false
    });

    const refreshed = getBot(botId, userId);
    if (!refreshed) {
      throw new Error("Bot not found");
    }
    if (refreshed.userId) {
      manager.broadcastAll({ type: "bot_updated", bot: toBotSummary(refreshed) }, refreshed.userId);
    }
    return toBotSummary(refreshed);
  } finally {
    releaseChatTurnStart(bot.homeConversationId, control);
  }
}

export function getBotStatus(bot: Bot): BotStatus {
  const conversation = getConversation(bot.homeConversationId);
  if (conversation?.isActive) return "running";

  const queuedRun = getDb()
    .prepare("SELECT 1 FROM bot_runs WHERE bot_id = ? AND status = 'queued' LIMIT 1")
    .get(bot.id);
  if (queuedRun) return "queued";

  return "idle";
}

export function getBotLastRunAt(botId: string): string | null {
  const row = getDb()
    .prepare("SELECT COALESCE(started_at, created_at) as last_at FROM bot_runs WHERE bot_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(botId) as { last_at: string | null } | undefined;
  return row?.last_at ?? null;
}

export function getBotPendingInputAt(bot: Bot): string | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(COALESCE(ma.proposal_updated_at, ma.started_at)) AS pending_at
       FROM message_actions ma
       INNER JOIN messages m ON m.id = ma.message_id
       WHERE m.conversation_id = ? AND ma.status = 'pending' AND ma.proposal_state = 'pending'`
    )
    .get(bot.homeConversationId) as { pending_at: string | null } | undefined;
  return row?.pending_at ?? null;
}

export function markBotPendingInputSeen(botId: string, userId?: string): Bot | null {
  const current = getBot(botId, userId);
  if (!current) return null;
  getDb()
    .prepare("UPDATE bots SET pending_input_seen_at = ? WHERE id = ?")
    .run(nowIso(), botId);
  return getBot(botId, userId);
}

export function toBotSummary(bot: Bot): BotSummary {
  const pendingInputAt = getBotPendingInputAt(bot);
  return {
    providerProfileId: getConversation(bot.homeConversationId)?.providerProfileId ?? null,
    id: bot.id,
    name: bot.name,
    title: bot.title,
    description: bot.description,
    avatarSeed: bot.avatarSeed,
    isChief: bot.isChief,
    homeConversationId: bot.homeConversationId,
    status: getBotStatus(bot),
    waitingForInput:
      pendingInputAt !== null &&
      (bot.pendingInputSeenAt === null || pendingInputAt > bot.pendingInputSeenAt),
    lastRunAt: getBotLastRunAt(bot.id),
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt
  };
}
