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

export function listMemories(filter?: { category?: string; search?: string }): UserMemory[] {
  let sql = `SELECT id, content, category, created_at, updated_at FROM user_memories`;
  const conditions: string[] = [];
  const params: unknown[] = [];

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

export function getMemory(memoryId: string): UserMemory | null {
  const row = getDb()
    .prepare(
      `SELECT id, content, category, created_at, updated_at FROM user_memories WHERE id = ?`
    )
    .get(memoryId) as Parameters<typeof rowToMemory>[0] | undefined;

  return row ? rowToMemory(row) : null;
}

export function createMemory(content: string, category: MemoryCategory): UserMemory {
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
      `INSERT INTO user_memories (id, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(memory.id, memory.content, memory.category, memory.createdAt, memory.updatedAt);

  return memory;
}

export function updateMemory(
  memoryId: string,
  input: { content?: string; category?: MemoryCategory }
): UserMemory | null {
  const current = getMemory(memoryId);
  if (!current) return null;

  const timestamp = nowIso();
  const content = input.content?.trim() ?? current.content;
  const category = input.category ?? current.category;

  getDb()
    .prepare(
      `UPDATE user_memories SET content = ?, category = ?, updated_at = ? WHERE id = ?`
    )
    .run(content, category, timestamp, memoryId);

  return getMemory(memoryId);
}

export function deleteMemory(memoryId: string): void {
  getDb().prepare("DELETE FROM user_memories WHERE id = ?").run(memoryId);
}

export function getMemoryCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM user_memories")
    .get() as { count: number };
  return row.count;
}
