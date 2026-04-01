import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import type { Skill } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function rowToSkill(row: {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}): Skill {
  const metadata = parseSkillContentMetadata(row.content);

  return {
    id: row.id,
    name: metadata.name?.trim() || row.name,
    description: metadata.description?.trim() || row.description,
    content: row.content,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function deriveDescription(content: string) {
  const metadata = parseSkillContentMetadata(content);

  if (metadata.description?.trim()) {
    return metadata.description.trim().slice(0, 240);
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }

    return line.slice(0, 240);
  }

  return "Reusable skill instructions.";
}

export function listSkills() {
  const rows = getDb()
    .prepare(
      `SELECT id, name, description, content, enabled, created_at, updated_at
       FROM skills
       ORDER BY created_at ASC`
    )
    .all() as Array<{
    id: string;
    name: string;
    description: string;
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
      `SELECT id, name, description, content, enabled, created_at, updated_at
       FROM skills
       WHERE id = ?`
    )
    .get(skillId) as
    | {
        id: string;
        name: string;
        description: string;
        content: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? rowToSkill(row) : null;
}

export function createSkill(input: { name: string; description?: string; content: string }) {
  const metadata = parseSkillContentMetadata(input.content);
  const timestamp = nowIso();
  const skill = {
    id: createId("skill"),
    name: metadata.name?.trim() || input.name.trim(),
    description: metadata.description?.trim() || input.description?.trim() || deriveDescription(input.content),
    content: input.content,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO skills (id, name, description, content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      skill.id,
      skill.name,
      skill.description,
      skill.content,
      skill.enabled ? 1 : 0,
      skill.createdAt,
      skill.updatedAt
    );

  return skill;
}

export function updateSkill(
  skillId: string,
  input: { name?: string; description?: string; content?: string; enabled?: boolean }
) {
  const current = getSkill(skillId);
  if (!current) return null;

  const timestamp = nowIso();
  const content = input.content ?? current.content;
  const metadata = parseSkillContentMetadata(content);
  const name = metadata.name?.trim() || input.name?.trim() || current.name;
  const description =
    metadata.description?.trim() ||
    input.description?.trim() ||
    current.description ||
    deriveDescription(content);
  const enabled = input.enabled ?? current.enabled;

  getDb()
    .prepare(
      `UPDATE skills SET name = ?, description = ?, content = ?, enabled = ?, updated_at = ? WHERE id = ?`
    )
    .run(name, description, content, enabled ? 1 : 0, timestamp, skillId);

  return getSkill(skillId);
}

export function deleteSkill(skillId: string) {
  getDb().prepare("DELETE FROM skills WHERE id = ?").run(skillId);
}

export function listEnabledSkills() {
  return listSkills().filter((skill) => skill.enabled);
}
