import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { MemoryCategory, UserMemory } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
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
  maybeFilter?: { category?: string; search?: string }
): UserMemory[] {
  const userId = typeof userIdOrFilter === "string" ? userIdOrFilter : undefined;
  const filter = typeof userIdOrFilter === "string" ? maybeFilter : userIdOrFilter;
  let sql = `SELECT id, content, category, created_at, updated_at FROM user_memories`;
  const conditions: string[] = userId ? ["user_id = ?"] : [];
  const params: unknown[] = userId ? [userId] : [];

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

export function getMemory(memoryId: string, userId?: string): UserMemory | null {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT id, content, category, created_at, updated_at FROM user_memories WHERE id = ? AND user_id = ?`
        )
        .get(memoryId, userId)
    : getDb()
        .prepare(
          `SELECT id, content, category, created_at, updated_at FROM user_memories WHERE id = ?`
        )
        .get(memoryId)) as Parameters<typeof rowToMemory>[0] | undefined;

  return row ? rowToMemory(row) : null;
}

export function createMemory(content: string, category: MemoryCategory, userId?: string): UserMemory {
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
      `INSERT INTO user_memories (id, user_id, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(memory.id, userId ?? null, memory.content, memory.category, memory.createdAt, memory.updatedAt);

  return memory;
}

export function updateMemory(
  memoryId: string,
  input: { content?: string; category?: MemoryCategory },
  userId?: string
): UserMemory | null {
  const current = getMemory(memoryId, userId);
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

  return getMemory(memoryId, userId);
}

export function deleteMemory(memoryId: string, userId?: string): void {
  if (userId) {
    getDb().prepare("DELETE FROM user_memories WHERE id = ? AND user_id = ?").run(memoryId, userId);
    return;
  }

  getDb().prepare("DELETE FROM user_memories WHERE id = ?").run(memoryId);
}

export function getMemoryCount(userId?: string): number {
  const row = (userId
    ? getDb().prepare("SELECT COUNT(*) as count FROM user_memories WHERE user_id = ?").get(userId)
    : getDb().prepare("SELECT COUNT(*) as count FROM user_memories").get()) as { count: number };
  return row.count;
}
