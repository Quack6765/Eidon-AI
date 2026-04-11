import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { Persona } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function rowToPersona(row: {
  id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}): Persona {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listPersonas(userId?: string): Persona[] {
  const rows = (userId
    ? getDb()
        .prepare(
          `SELECT id, name, content, created_at, updated_at
           FROM personas
           WHERE user_id = ?
           ORDER BY created_at ASC`
        )
        .all(userId)
    : getDb()
        .prepare(
          `SELECT id, name, content, created_at, updated_at
           FROM personas
           ORDER BY created_at ASC`
        )
        .all()) as Array<{
    id: string;
    name: string;
    content: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToPersona);
}

export function getPersona(personaId: string, userId?: string): Persona | null {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT id, name, content, created_at, updated_at
           FROM personas
           WHERE id = ? AND user_id = ?`
        )
        .get(personaId, userId)
    : getDb()
        .prepare(
          `SELECT id, name, content, created_at, updated_at
           FROM personas
           WHERE id = ?`
        )
        .get(personaId)) as {
    id: string;
    name: string;
    content: string;
    created_at: string;
    updated_at: string;
  } | undefined;

  return row ? rowToPersona(row) : null;
}

export function createPersona(input: { name: string; content: string }, userId?: string): Persona {
  const timestamp = nowIso();
  const persona: Persona = {
    id: createId("persona"),
    name: input.name.trim(),
    content: input.content,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO personas (id, user_id, name, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(persona.id, userId ?? null, persona.name, persona.content, persona.createdAt, persona.updatedAt);

  return persona;
}

export function updatePersona(
  personaId: string,
  input: { name?: string; content?: string },
  userId?: string
): Persona | null {
  const current = getPersona(personaId, userId);
  if (!current) return null;

  const timestamp = nowIso();
  const name = input.name?.trim() ?? current.name;
  const content = input.content ?? current.content;

  if (userId) {
    getDb()
      .prepare(
        `UPDATE personas SET name = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?`
      )
      .run(name, content, timestamp, personaId, userId);
  } else {
    getDb()
      .prepare(
        `UPDATE personas SET name = ?, content = ?, updated_at = ? WHERE id = ?`
      )
      .run(name, content, timestamp, personaId);
  }

  return getPersona(personaId, userId);
}

export function deletePersona(personaId: string, userId?: string): void {
  if (userId) {
    getDb().prepare("DELETE FROM personas WHERE id = ? AND user_id = ?").run(personaId, userId);
    return;
  }

  getDb().prepare("DELETE FROM personas WHERE id = ?").run(personaId);
}
