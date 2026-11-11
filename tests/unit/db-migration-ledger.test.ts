import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { listMigrationSteps, migrate } from "@/lib/db-migrations";

const goldenSnapshot = JSON.parse(
  fs.readFileSync(path.resolve("tests/fixtures/db-schema-golden.json"), "utf8")
) as {
  tables: Array<{ name: string; sql: string | null; columns: unknown[] }>;
  indexes: Array<{ name: string; sql: string }>;
};

function schemaSnapshot(db: Database.Database) {
  const tables = (
    db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name"
      )
      .all() as Array<{ name: string; sql: string | null }>
  ).map((row) => ({
    name: row.name,
    sql: row.sql,
    columns: db.prepare(`PRAGMA table_info(${row.name})`).all()
  }));
  const indexes = (
    db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
      .all() as Array<{ name: string; sql: string }>
  ).map((row) => ({ name: row.name, sql: row.sql }));
  return { tables, indexes };
}

function ledgerRows(db: Database.Database) {
  return (
    db.prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name").all() as Array<{
      name: string;
      applied_at: string;
    }>
  );
}

function forgetStep(db: Database.Database, name: string) {
  db.prepare("DELETE FROM schema_migrations WHERE name = ?").run(name);
}

describe("db migration ledger", () => {
  it("keeps step names unique so the append point stays unambiguous", () => {
    const names = listMigrationSteps();
    expect(new Set(names).size).toBe(names.length);
  });

  it("builds the golden schema on a fresh install and records every step", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);

    expect(schemaSnapshot(db)).toEqual(goldenSnapshot);

    const rows = ledgerRows(db);
    expect(rows.map((row) => row.name)).toEqual([...listMigrationSteps()].sort());
    for (const row of rows) {
      expect(() => new Date(row.applied_at).toISOString()).not.toThrow();
    }
    db.close();
  });

  it("bootstraps the ledger on a pre-ledger database without touching its schema", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    const before = schemaSnapshot(db);
    db.exec(`
      CREATE TABLE migration_flags (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO migration_flags (name, applied_at) VALUES ('bot_conversations_follow_default_provider', '2026-01-01T00:00:00.000Z');
    `);
    db.exec("DELETE FROM schema_migrations");

    migrate(db);

    expect(schemaSnapshot(db)).toEqual(before);
    expect(schemaSnapshot(db)).toEqual(goldenSnapshot);
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migration_flags'").get()
    ).toBeUndefined();
    expect(ledgerRows(db).map((row) => row.name)).toEqual([...listMigrationSteps()].sort());
    db.close();
  });

  it("applies only the missing steps on a partially-migrated database", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    db.exec("DELETE FROM schema_migrations");
    db.exec("ALTER TABLE user_memories DROP COLUMN pinned");
    db.exec("ALTER TABLE message_attachments DROP COLUMN source_path");

    migrate(db);

    expect(schemaSnapshot(db)).toEqual(goldenSnapshot);
    expect(ledgerRows(db).map((row) => row.name)).toEqual([...listMigrationSteps()].sort());
    db.close();
  });

  it("applies nothing on the second run", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    const rowsBefore = ledgerRows(db);
    const snapshotBefore = schemaSnapshot(db);

    migrate(db);

    expect(ledgerRows(db)).toEqual(rowsBefore);
    expect(schemaSnapshot(db)).toEqual(snapshotBefore);
    db.close();
  });

  it("applies exactly one step's change when a single step is missing", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    const rowsBefore = ledgerRows(db).filter((row) => row.name !== "user_memories_pinned_column");
    db.exec("ALTER TABLE user_memories DROP COLUMN pinned");
    forgetStep(db, "user_memories_pinned_column");

    migrate(db);

    expect(
      (db.prepare("PRAGMA table_info(user_memories)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    ).toContain("pinned");
    const rowsAfter = ledgerRows(db).filter((row) => row.name !== "user_memories_pinned_column");
    expect(rowsAfter).toEqual(rowsBefore);
    expect(schemaSnapshot(db)).toEqual(goldenSnapshot);
    db.close();
  });

  it("converges when two processes migrate the same database file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-ledger-"));
    try {
      const dbPath = path.join(dir, "eidon.db");
      const first = new Database(dbPath);
      const second = new Database(dbPath);
      first.pragma("foreign_keys = ON");
      second.pragma("foreign_keys = ON");

      migrate(first);
      migrate(second);

      const expectedNames = [...listMigrationSteps()].sort();
      expect(ledgerRows(first).map((row) => row.name)).toEqual(expectedNames);
      expect(ledgerRows(second).map((row) => row.name)).toEqual(expectedNames);

      forgetStep(first, "user_memories_pinned_column");
      first.exec("ALTER TABLE user_memories DROP COLUMN pinned");
      migrate(second);
      expect(
        (first.prepare("PRAGMA table_info(user_memories)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      ).toContain("pinned");
      expect(ledgerRows(first).map((row) => row.name)).toEqual(expectedNames);

      first.close();
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
