import { getDb } from "@/lib/db";

describe("automations schema", () => {
  it("creates automations tables and automation conversation columns", () => {
    const db = getDb();

    const automationCols = db.prepare("PRAGMA table_info(automations)").all() as Array<{
      name: string;
    }>;
    const runCols = db.prepare("PRAGMA table_info(automation_runs)").all() as Array<{
      name: string;
    }>;
    const conversationCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{
      name: string;
    }>;

    expect(automationCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["prompt", "schedule_kind", "next_run_at", "enabled"])
    );
    expect(runCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["automation_id", "conversation_id", "scheduled_for", "status"])
    );
    expect(conversationCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["automation_id", "automation_run_id", "conversation_origin"])
    );
  });
});
