import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat-turn", () => ({ startChatTurn: vi.fn(async () => ({ status: "completed" })) }));
vi.mock("@/lib/ws-singleton", () => ({ getConversationManager: vi.fn(() => ({})) }));

import {
  ensureSkillMaintenanceScheduler,
  listSkillOwnerIds,
  runConsolidationFork,
  runSkillMaintenanceForOwner,
  tickSkillMaintenance
} from "@/lib/skill-maintenance";
import { getCuratorConfig, readCuratorState, seedCuratorState, updateCuratorConfig } from "@/lib/skill-curator";
import { buildSkillMarkdown, createLibrarySkill, ensureLibraryReady, listLibrarySkills } from "@/lib/skill-library";
import { bumpUse, getUsageRecord, recordCreated } from "@/lib/skill-usage";
import { createBot } from "@/lib/bots";
import { createLocalUser } from "@/lib/users";

async function ownerWithBot(prefix: string) {
  const user = await createLocalUser({
    username: `${prefix}-${Math.random().toString(36).slice(2, 8)}`,
    password: "password-123",
    role: "user" as const
  });
  const bot = createBot({ name: `${prefix} ${Math.random().toString(36).slice(2, 6)}` }, user.id);
  return { user, bot, ownerUserId: user.id };
}

describe("skill maintenance", () => {
  it("lists each distinct owner once", async () => {
    const first = await ownerWithBot("owner-a");
    createBot({ name: `Second ${Math.random().toString(36).slice(2, 6)}` }, first.user.id);
    const second = await ownerWithBot("owner-b");

    const owners = listSkillOwnerIds();
    expect(owners).toContain(first.user.id);
    expect(owners).toContain(second.user.id);
    expect(owners.filter((owner) => owner === first.user.id)).toHaveLength(1);
  });

  it("defers to the schedule unless forced", async () => {
    const { user } = await ownerWithBot("deferred");
    const outcome = await runSkillMaintenanceForOwner(user.id);
    expect(outcome).toEqual({ ran: false, summary: null, reason: "first-run-deferred" });

    const forced = await runSkillMaintenanceForOwner(user.id, { force: true });
    expect(forced.ran).toBe(true);
    expect(forced.summary).toContain("Curator:");
  });

  it("does not run while the owner is still working", async () => {
    const { user, bot } = await ownerWithBot("busy");
    ensureLibraryReady(user.id);
    createLibrarySkill(user.id, {
      name: "busy-skill",
      content: buildSkillMarkdown("busy-skill", "Trigger.", "Body."),
      agentAuthored: true
    });

    const { scheduleSkillReview } = await import("@/lib/skill-review");
    await scheduleSkillReview({ bot, conversationId: bot.homeConversationId, assistantMessageId: null });

    const state = readCuratorState(user.id);
    expect(state.lastInteractionAt).not.toBeNull();

    seedCuratorState(user.id);
    const outcome = await runSkillMaintenanceForOwner(user.id);
    expect(outcome).toEqual({ ran: false, summary: null, reason: "not-due" });
  });

  it("archives a stale curator-managed skill when forced to run", async () => {
    const { user } = await ownerWithBot("staler");
    ensureLibraryReady(user.id);
    createLibrarySkill(user.id, {
      name: "gone-off",
      content: buildSkillMarkdown("gone-off", "Trigger.", "Body."),
      agentAuthored: true
    });
    recordCreated(user.id, "gone-off", { agentCreated: true });
    bumpUse(user.id, "gone-off");

    const record = getUsageRecord(user.id, "gone-off")!;
    expect(record.state).toBe("active");

    const outcome = await runSkillMaintenanceForOwner(user.id, { force: true });
    expect(outcome.ran).toBe(true);
  });

  describe("the consolidation fork", () => {
    it("does nothing while consolidation is switched off", async () => {
      const { user, bot } = await ownerWithBot("no-fork");
      expect(getCuratorConfig().consolidate).toBe(false);

      const { startChatTurn } = await import("@/lib/chat-turn");
      vi.mocked(startChatTurn).mockClear();

      expect(await runConsolidationFork(user.id, bot, getCuratorConfig())).toBeNull();
      expect(startChatTurn).not.toHaveBeenCalled();
    });

    it("runs an umbrella-building pass when switched on", async () => {
      const { user, bot } = await ownerWithBot("fork");
      ensureLibraryReady(user.id);
      createLibrarySkill(user.id, {
        name: "sibling-one",
        content: buildSkillMarkdown("sibling-one", "Trigger.", "Body."),
        agentAuthored: true
      });

      const config = { ...getCuratorConfig(), consolidate: true };
      const { startChatTurn } = await import("@/lib/chat-turn");
      vi.mocked(startChatTurn).mockClear();

      const summary = await runConsolidationFork(user.id, bot, config);
      expect(startChatTurn).toHaveBeenCalledTimes(1);
      expect(typeof summary).toBe("string");
    });
  });

  it("ticks every owner and reports how many ran", async () => {
    await ownerWithBot("ticked");
    expect(await tickSkillMaintenance()).toBeGreaterThanOrEqual(0);
  });

  it("starts one scheduler and stops it cleanly", () => {
    const handle = ensureSkillMaintenanceScheduler();
    const second = ensureSkillMaintenanceScheduler();
    expect(second).toBe(handle);

    handle.stop();
    const restarted = ensureSkillMaintenanceScheduler();
    expect(restarted).not.toBe(handle);
    restarted.stop();
  });

  it("keeps the maintenance config writable", () => {
    const updated = updateCuratorConfig({ staleAfterDays: 21, backgroundReview: { enabled: true } });
    expect(updated.staleAfterDays).toBe(21);
    expect(updated.backgroundReview.enabled).toBe(true);
    expect(updated.archiveAfterDays).toBe(30);
  });

  it("leaves an empty owner with nothing to do", async () => {
    const outcome = await runSkillMaintenanceForOwner("user_maintenance_empty", { force: true });
    expect(outcome.ran).toBe(true);
    expect(listLibrarySkills("user_maintenance_empty")).toEqual([]);
  });
});
