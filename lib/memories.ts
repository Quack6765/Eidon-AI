import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { MemoryCategory, UserMemory } from "@/lib/types";
import { nowIso } from "@/lib/utils";

export type MemoryScope = { botId?: string };

function botScopeCondition(scope?: MemoryScope) {
  return scope?.botId ? "bot_id = ?" : "bot_id IS NULL";
}

function rowToMemory(row: {
  id: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}): UserMemory {
  return {
    id: row.id,
    content: row.content,
    category: row.category as MemoryCategory,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listMemories(
  userIdOrFilter?: string | { category?: string; search?: string },
  maybeFilter?: { category?: string; search?: string },
  scope?: MemoryScope
): UserMemory[] {
  const userId = typeof userIdOrFilter === "string" ? userIdOrFilter : undefined;
  const filter = typeof userIdOrFilter === "string" ? maybeFilter : userIdOrFilter;
  let sql = `SELECT id, content, category, created_at, updated_at FROM user_memories`;
  const conditions: string[] = userId ? ["user_id = ?"] : [];
  const params: unknown[] = userId ? [userId] : [];

  conditions.push(botScopeCondition(scope));
  if (scope?.botId) {
    params.push(scope.botId);
  }

  if (filter?.category) {
    conditions.push("category = ?");
    params.push(filter.category);
  }

  if (filter?.search) {
    conditions.push("content LIKE ?");
    params.push(`%${filter.search}%`);
  }

  if (conditions.length) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  sql += " ORDER BY updated_at DESC";

  const rows = params.length
    ? getDb().prepare(sql).all(...params) as Array<Parameters<typeof rowToMemory>[0]>
    : getDb().prepare(sql).all() as Array<Parameters<typeof rowToMemory>[0]>;

  return rows.map(rowToMemory);
}

export function getMemory(memoryId: string, userId?: string | null, scope?: MemoryScope): UserMemory | null {
  const scopes = botScopeCondition(scope);
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT id, content, category, created_at, updated_at FROM user_memories WHERE id = ? AND user_id = ? AND ${scopes}`
        )
        .get(...(scope?.botId ? [memoryId, userId, scope.botId] : [memoryId, userId]))
    : getDb()
        .prepare(
          `SELECT id, content, category, created_at, updated_at FROM user_memories WHERE id = ? AND ${scopes}`
        )
        .get(...(scope?.botId ? [memoryId, scope.botId] : [memoryId]))) as Parameters<typeof rowToMemory>[0] | undefined;

  return row ? rowToMemory(row) : null;
}

export function createMemory(
  content: string,
  category: MemoryCategory,
  userId?: string,
  scope?: MemoryScope
): UserMemory {
  const timestamp = nowIso();
  const memory: UserMemory = {
    id: createId("mem"),
    content: content.trim(),
    category,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO user_memories (id, user_id, bot_id, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      memory.id,
      userId ?? null,
      scope?.botId ?? null,
      memory.content,
      memory.category,
      memory.createdAt,
      memory.updatedAt
    );

  return memory;
}

export function updateMemory(
  memoryId: string,
  input: { content?: string; category?: MemoryCategory },
  userId?: string,
  scope?: MemoryScope
): UserMemory | null {
  const current = getMemory(memoryId, userId, scope);
  if (!current) return null;

  const timestamp = nowIso();
  const content = input.content?.trim() ?? current.content;
  const category = input.category ?? current.category;

  if (userId) {
    getDb()
      .prepare(
        `UPDATE user_memories SET content = ?, category = ?, updated_at = ? WHERE id = ? AND user_id = ?`
      )
      .run(content, category, timestamp, memoryId, userId);
  } else {
    getDb()
      .prepare(
        `UPDATE user_memories SET content = ?, category = ?, updated_at = ? WHERE id = ?`
      )
      .run(content, category, timestamp, memoryId);
  }

  return getMemory(memoryId, userId, scope);
}

export function deleteMemory(memoryId: string, userId?: string, scope?: MemoryScope): void {
  const scopes = botScopeCondition(scope);
  if (userId) {
    getDb()
      .prepare(`DELETE FROM user_memories WHERE id = ? AND user_id = ? AND ${scopes}`)
      .run(...(scope?.botId ? [memoryId, userId, scope.botId] : [memoryId, userId]));
    return;
  }

  getDb()
    .prepare(`DELETE FROM user_memories WHERE id = ? AND ${scopes}`)
    .run(...(scope?.botId ? [memoryId, scope.botId] : [memoryId]));
}

export function getMemoryCount(userId?: string | null, scope?: MemoryScope): number {
  const scopes = botScopeCondition(scope);
  const row = (userId
    ? getDb()
        .prepare(`SELECT COUNT(*) as count FROM user_memories WHERE user_id = ? AND ${scopes}`)
        .get(...(scope?.botId ? [userId, scope.botId] : [userId]))
    : getDb()
        .prepare(`SELECT COUNT(*) as count FROM user_memories WHERE ${scopes}`)
        .get(...(scope?.botId ? [scope.botId] : []))) as { count: number };
  return row.count;
}

export function listMemoriesForPrompt(userId: string, scope?: MemoryScope): UserMemory[] {
  const main = listMemories(userId);
  if (!scope?.botId) {
    return main;
  }
  return [...main, ...listMemories(userId, undefined, scope)];
}
