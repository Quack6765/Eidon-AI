import { randomInt } from "node:crypto";

import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { createConversation, deleteConversation, getConversation, renameConversation } from "@/lib/conversations";
import { getConversationManager } from "@/lib/ws-singleton";
import { nowIso } from "@/lib/utils";
import { ensureBotWorkspace, removeBotBrowserSession, removeBotWorkspace } from "@/lib/bot-sandbox";
import type { Bot, BotStatus, BotSummary } from "@/lib/types";

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
  created_at: string;
  updated_at: string;
};

const BOT_COLUMNS = `id, user_id, name, title, description, avatar_seed, system_prompt, is_chief, home_conversation_id, created_at, updated_at`;

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

export function buildDefaultWorkerSystemPrompt(input: {
  name: string;
  title: string;
  description: string;
}) {
  return [
    `You are ${input.name}${input.title ? `, ${input.title}` : ""}, a specialist bot on the user's team.`,
    input.description ? `Your role: ${input.description}` : null,
    "You have your own dedicated browser session and file workspace — use them for all browsing and file work instead of shared state.",
    "Facts about the user come from the shared account memory, which is read-only for you — your memory tools write to your own private memory pool.",
    "Complete tasks fully and autonomously, then report results concisely."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChiefSystemPrompt(roster: Array<Pick<Bot, "name" | "title" | "description">>) {
  const rosterLines = roster.length
    ? ["Your team of specialist bots:", ...roster.map((bot) => `- ${bot.name}${bot.title ? ` (${bot.title})` : ""}${bot.description ? `: ${bot.description}` : ""}`)]
    : ["You currently have no specialist bots. When a lane of recurring work emerges, create a focused bot for it with create_bot."];

  return [
    `You are ${CHIEF_BOT_NAME}, the user's primary assistant coordinating a team of specialist bots.`,
    "",
    "How you work:",
    "- Answer directly for quick questions and small tasks you can handle yourself.",
    "- Delegate substantive or recurring work to the specialist bot that owns that area using delegate_task. It returns immediately: after sending, tell the user right away what you asked and that you will let them know once you have the answer, then continue with other work. The bot's reply arrives here as a new message — relay it when it lands.",
    "- If no existing bot fits a job that deserves a long-lived owner, create one with create_bot, then delegate to it.",
    "- When a bot's responsibilities change, update it with update_bot (rename it, or revise its title, description, or system prompt) instead of creating a duplicate.",
    "- Never delegate to yourself, and do not create a bot for work that only happens once and is trivial for you to do.",
    "",
    ...rosterLines,
    "",
    "Each bot has its own persistent browser session, file workspace, and private memory pool, and runs with the user's configured provider and settings."
  ].join("\n");
}

export function buildBotSystemPrompt(bot: Bot) {
  if (!bot.isChief) {
    return bot.systemPrompt || buildDefaultWorkerSystemPrompt(bot);
  }
  const roster = listBots(bot.userId ?? undefined).filter((candidate) => !candidate.isChief);
  return buildChiefSystemPrompt(roster);
}

export function buildChiefRoster(userId?: string) {
  return listBots(userId)
    .filter((bot) => !bot.isChief)
    .map((bot) => ({ name: bot.name, title: bot.title, description: bot.description }));
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
    const conversation = createConversation(name, null, { origin: "bot" }, userId ?? undefined);
    return insertBot({
      userId: userId ?? undefined,
      name,
      title,
      description,
      systemPrompt:
        input.systemPrompt?.trim() ||
        buildDefaultWorkerSystemPrompt({ name, title, description }),
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
  },
  userId?: string
): Bot | null {
  const current = getBot(botId, userId);
  if (!current) return null;

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

export function toBotSummary(bot: Bot): BotSummary {
  return {
    id: bot.id,
    name: bot.name,
    title: bot.title,
    description: bot.description,
    avatarSeed: bot.avatarSeed,
    isChief: bot.isChief,
    homeConversationId: bot.homeConversationId,
    status: getBotStatus(bot),
    lastRunAt: getBotLastRunAt(bot.id),
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt
  };
}
