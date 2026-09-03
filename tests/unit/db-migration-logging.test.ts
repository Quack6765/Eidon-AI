import { describe, expect, it, vi } from "vitest";

import { getDb, migrate } from "@/lib/db";

describe("database migration logging", () => {
  it("logs fresh database initialization, data migrations, and completion", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      getDb();

      const lines = logSpy.mock.calls.map((call) => call.join(" "));
      expect(lines).toContain("[db] Initializing new database");
      expect(lines).toContain("[db] Running database migrations...");
      expect(lines).toContain("[db] Migrating legacy settings storage (app_settings/user_settings)");
      expect(lines).toContain("[db] Migrating provider storage from legacy schema...");
      expect(lines.some((line) => line.startsWith("[db] Provider storage migration done in"))).toBe(true);
      expect(lines).toContain("[db] Rebuilding compaction events table...");
      expect(lines.some((line) => line.startsWith("[db] Compaction events rebuild done in"))).toBe(true);
      expect(lines).toContain("[db] Migrating integration settings...");
      expect(lines.some((line) => line.startsWith("[db] Migrating integration settings done in"))).toBe(true);
      expect(lines).toContain("[db] Migrating preference storage...");
      expect(lines.some((line) => line.startsWith("[db] Migrating preference storage done in"))).toBe(true);
      expect(lines).toContain("[db] Created semantic_chunks table");
      expect(lines.some((line) => line.startsWith("[db] Database migrations complete in"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("logs only the summary on an already-migrated database", () => {
    const db = getDb();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      migrate(db);

      const lines = logSpy.mock.calls.map((call) => call.join(" "));
      expect(lines).toContain("[db] Running database migrations...");
      expect(lines.some((line) => line.startsWith("[db] Database migrations complete in"))).toBe(true);
      expect(lines.some((line) => line.includes("Initializing new database"))).toBe(false);
      expect(lines.some((line) => line.includes("Migrating legacy settings"))).toBe(false);
      expect(lines.some((line) => line.includes("Migrating provider storage"))).toBe(false);
      expect(lines.some((line) => line.includes("Migrating provider connection"))).toBe(false);
      expect(lines.some((line) => line.includes("Rebuilding compaction events"))).toBe(false);
      expect(lines.some((line) => line.includes("Migrating integration settings"))).toBe(false);
      expect(lines.some((line) => line.includes("Migrating preference storage"))).toBe(false);
      expect(lines.some((line) => line.includes("Created semantic_chunks table"))).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});
