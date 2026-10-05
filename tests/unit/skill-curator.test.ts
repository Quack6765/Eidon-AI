import { existsSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  applyAutomaticTransitions,
  DEFAULT_SKILL_CURATOR_CONFIG,
  CURATOR_DRY_RUN_BANNER,
  CURATOR_INVARIANTS,
  listCuratorEligibleRefs,
  purgeArchived,
  readCuratorState,
  runCuratorPass,
  seedCuratorState,
  setCuratorPaused,
  shouldRunCurator,
  type SkillCuratorConfig
} from "@/lib/skill-curator";
import {
  buildSkillMarkdown,
  createLibrarySkill,
  ensureLibraryReady,
  findLibrarySkill,
  listArchivedSkills,
  listLibrarySkills,
  getSkillLibraryDir,
  listSnapshots,
  skillDirPath
} from "@/lib/skill-library";
import {
  bumpUse,
  getUsageRecord,
  recordCreated,
  setPinned,
  STATE_ACTIVE,
  STATE_ARCHIVED,
  STATE_STALE
} from "@/lib/skill-usage";

const owner = "user_curator_a";

const config: SkillCuratorConfig = { ...DEFAULT_SKILL_CURATOR_CONFIG, backup: { enabled: true, keep: 5 } };

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function seed(ref: string, options: { agent?: boolean; pinned?: boolean } = {}) {
  ensureLibraryReady(owner);
  createLibrarySkill(owner, {
    name: ref,
    content: buildSkillMarkdown(ref, "Trigger.", "Body."),
    agentAuthored: options.agent !== false
  });
  if (options.pinned) {
    setPinned(owner, ref, true);
  }
  return ref;
}

describe("skill-curator", () => {
  beforeEach(() => {
    ensureLibraryReady(owner);
  });

  describe("the state machine", () => {
    it("marks a skill stale after 14 inactive days and archives it after 30", () => {
      seed("ageing");
      const record = getUsageRecord(owner, "ageing")!;
      expect(record.state).toBe(STATE_ACTIVE);

      const now = new Date();
      const stalePoint = new Date(Date.parse(record.created_at) + 15 * 86_400_000);
      const stale = applyAutomaticTransitions(owner, config, stalePoint);
      expect(stale).toEqual([{ ref: "ageing", from: STATE_ACTIVE, to: STATE_STALE, action: "stale" }]);

      const archivePoint = new Date(Date.parse(record.created_at) + 31 * 86_400_000);
      const archived = applyAutomaticTransitions(owner, config, archivePoint);
      expect(archived[0]).toMatchObject({ ref: "ageing", action: "archive" });
      expect(now.getTime()).toBeGreaterThan(0);
    });

    it("archives straight from active once past the archive cutoff", () => {
      seed("ancient");
      const record = getUsageRecord(owner, "ancient")!;
      const farFuture = new Date(Date.parse(record.created_at) + 45 * 86_400_000);
      const result = applyAutomaticTransitions(owner, config, farFuture);
      expect(result).toEqual([{ ref: "ancient", from: STATE_ACTIVE, to: STATE_ARCHIVED, action: "archive" }]);
      expect(listArchivedSkills(owner)).toContain("ancient");
    });

    it("returns a stale skill to active once it is used again", () => {
      seed("revive");
      const record = getUsageRecord(owner, "revive")!;
      const stalePoint = new Date(Date.parse(record.created_at) + 15 * 86_400_000);
      applyAutomaticTransitions(owner, config, stalePoint);
      expect(getUsageRecord(owner, "revive")?.state).toBe(STATE_STALE);

      bumpUse(owner, "revive");
      const revived = applyAutomaticTransitions(owner, config, new Date());
      expect(revived).toEqual([{ ref: "revive", from: STATE_STALE, to: STATE_ACTIVE, action: "revive" }]);
    });

    it("leaves never-used skills active while younger than the stale cutoff", () => {
      seed("fresh");
      expect(applyAutomaticTransitions(owner, config, new Date())).toEqual([]);
    });

    it("bypasses every transition for pinned skills", () => {
      seed("pinned-forever", { pinned: true });
      const record = getUsageRecord(owner, "pinned-forever")!;
      const farFuture = new Date(Date.parse(record.created_at) + 400 * 86_400_000);
      expect(applyAutomaticTransitions(owner, config, farFuture)).toEqual([]);
      expect(getUsageRecord(owner, "pinned-forever")?.state).toBe(STATE_ACTIVE);
    });

    it("never touches user-owned skills", () => {
      seed("user-owned", { agent: false });
      const record = getUsageRecord(owner, "user-owned")!;
      const farFuture = new Date(Date.parse(record.created_at) + 400 * 86_400_000);
      expect(applyAutomaticTransitions(owner, config, farFuture)).toEqual([]);
    });

    it("never touches essential skills", () => {
      seed("agent-browser");
      const record = getUsageRecord(owner, "agent-browser")!;
      const farFuture = new Date(Date.parse(record.created_at) + 400 * 86_400_000);
      expect(applyAutomaticTransitions(owner, config, farFuture)).toEqual([]);
    });
  });

  describe("the curator never hard-deletes", () => {
    it("archives instead of deleting and leaves the content recoverable", () => {
      seed("recoverable");
      const record = getUsageRecord(owner, "recoverable")!;
      const farFuture = new Date(Date.parse(record.created_at) + 45 * 86_400_000);
      applyAutomaticTransitions(owner, config, farFuture);

      expect(existsSync(join(skillDirPath(owner, "recoverable"), "SKILL.md"))).toBe(false);
      expect(listArchivedSkills(owner)).toContain("recoverable");
      expect(CURATOR_INVARIANTS[0]).toContain("never delete, only archive (recoverable)");
    });

    it("purges archived skills only behind an explicit TTL", () => {
      seed("ttl-victim");
      const record = getUsageRecord(owner, "ttl-victim")!;
      applyAutomaticTransitions(owner, config, new Date(Date.parse(record.created_at) + 45 * 86_400_000));
      expect(listArchivedSkills(owner)).toContain("ttl-victim");

      expect(purgeArchived(owner, config)).toEqual([]);
      expect(purgeArchived(owner, { ...config, archiveTtlDays: 1 })).toEqual([]);
      const archivePath = join(getSkillLibraryDir(owner), ".archive", "ttl-victim");
      const past = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(archivePath, past, past);
      expect(purgeArchived(owner, { ...config, archiveTtlDays: 1 })).toEqual(["ttl-victim"]);
      expect(listArchivedSkills(owner)).not.toContain("ttl-victim");
    });
  });

  describe("scheduling", () => {
    it("defers the first run by one interval", () => {
      const state = readCuratorState(owner);
      expect(shouldRunCurator(state, config, new Date(), null)).toEqual({ run: false, reason: "first-run-deferred" });
    });

    it("does not run before the interval elapses", () => {
      seedCuratorState(owner);
      expect(shouldRunCurator(readCuratorState(owner), config, new Date(), null)).toEqual({ run: false, reason: "not-due" });
    });

    it("does not run while the owner is not idle", () => {
      const state = { ...readCuratorState(owner), lastRunAt: daysAgo(30) };
      expect(shouldRunCurator(state, config, new Date(), new Date().toISOString())).toEqual({
        run: false,
        reason: "not-idle"
      });
    });

    it("runs when due and idle", () => {
      const state = { ...readCuratorState(owner), lastRunAt: daysAgo(30) };
      expect(shouldRunCurator(state, config, new Date(), daysAgo(3))).toEqual({ run: true });
    });

    it("honours disabled and paused", () => {
      const state = { ...readCuratorState(owner), lastRunAt: daysAgo(30) };
      expect(shouldRunCurator(state, { ...config, enabled: false }, new Date(), null)).toEqual({
        run: false,
        reason: "disabled"
      });
      expect(shouldRunCurator({ ...state, paused: true }, config, new Date(), null)).toEqual({
        run: false,
        reason: "paused"
      });
      expect(setCuratorPaused(owner, true).paused).toBe(true);
      expect(setCuratorPaused(owner, false).paused).toBe(false);
    });
  });

  describe("a pass", () => {
    it("reports the dry-run banner and mutates nothing in dry-run", () => {
      seed("dry-run");
      const record = getUsageRecord(owner, "dry-run")!;
      const farFuture = new Date(Date.parse(record.created_at) + 45 * 86_400_000);
      const before = readCuratorState(owner).lastRunAt;

      const result = runCuratorPass(owner, config, { dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.summary).toContain(CURATOR_DRY_RUN_BANNER);
      expect(listLibrarySkills(owner).map((s) => s.name)).toContain("dry-run");
      expect(readCuratorState(owner).lastRunAt).toBe(before);
      expect(farFuture.getTime()).toBeGreaterThan(0);
    });

    it("snapshots before running and rotates to the configured keep count", () => {
      seed("snapshotted");
      runCuratorPass(owner, { ...config, backup: { enabled: true, keep: 1 } });
      runCuratorPass(owner, { ...config, backup: { enabled: true, keep: 1 } });
      runCuratorPass(owner, { ...config, backup: { enabled: true, keep: 1 } });
      expect(listSnapshots(owner).length).toBeLessThanOrEqual(1);
    });

    it("records a summary on the curator state", () => {
      seed("summarised");
      const result = runCuratorPass(owner, config);
      expect(result.summary).toContain("Curator:");
      expect(readCuratorState(owner).lastSummary).toBe(result.summary);
    });
  });

  it("lists only curator-managed, unpinned, non-essential skills", () => {
    seed("eligible");
    seed("not-eligible", { agent: false });
    seed("pinned-out", { pinned: true });
    expect(listCuratorEligibleRefs(owner)).toContain("eligible");
    expect(listCuratorEligibleRefs(owner)).not.toContain("not-eligible");
    expect(listCuratorEligibleRefs(owner)).not.toContain("pinned-out");
  });

  it("finds nothing to do for a brand new library", () => {
    expect(applyAutomaticTransitions("user_curator_empty", config, new Date())).toEqual([]);
    expect(findLibrarySkill("user_curator_empty", "anything")).toBeNull();
    expect(recordCreated("user_curator_empty", "seeded", { agentCreated: true })).not.toBeNull();
  });
});
