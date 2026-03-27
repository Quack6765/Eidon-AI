import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { Skill } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function rowToSkill(row: {
  id: string;
  name: string;
  content: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}): Skill {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listSkills() {
  const rows = getDb()
    .prepare(
      `SELECT id, name, content, enabled, created_at, updated_at
       FROM skills
       ORDER BY created_at ASC`
    )
    .all() as Array<{
    id: string;
    name: string;
    content: string;
    enabled: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToSkill);
}

export function getSkill(skillId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, name, content, enabled, created_at, updated_at
       FROM skills
       WHERE id = ?`
    )
    .get(skillId) as
    | {
        id: string;
        name: string;
        content: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? rowToSkill(row) : null;
}

export function createSkill(input: { name: string; content: string }) {
  const timestamp = nowIso();
  const skill = {
    id: createId("skill"),
    name: input.name,
    content: input.content,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO skills (id, name, content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(skill.id, skill.name, skill.content, skill.enabled ? 1 : 0, skill.createdAt, skill.updatedAt);

  return skill;
}

export function updateSkill(
  skillId: string,
  input: { name?: string; content?: string; enabled?: boolean }
) {
  const current = getSkill(skillId);
  if (!current) return null;

  const timestamp = nowIso();
  const name = input.name ?? current.name;
  const content = input.content ?? current.content;
  const enabled = input.enabled ?? current.enabled;

  getDb()
    .prepare(
      `UPDATE skills SET name = ?, content = ?, enabled = ?, updated_at = ? WHERE id = ?`
    )
    .run(name, content, enabled ? 1 : 0, timestamp, skillId);

  return getSkill(skillId);
}

export function deleteSkill(skillId: string) {
  getDb().prepare("DELETE FROM skills WHERE id = ?").run(skillId);
}

export function listEnabledSkills() {
  return listSkills().filter((skill) => skill.enabled);
}
