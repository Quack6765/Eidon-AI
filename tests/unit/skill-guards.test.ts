import { describe, expect, it } from "vitest";

import {
  assertAdminSkillsAreReadOnly,
  assertConsolidationDelete,
  assertEssentialGuard,
  assertOriginGuard,
  assertPinnedGuard,
  assertReadBeforeWrite,
  buildGuardTarget,
  describeProvenance,
  evaluateSkillGuards,
  type GuardTarget
} from "@/lib/skill-guards";
import { buildSkillMarkdown, createLibrarySkill, ensureLibraryReady, skillDirPath } from "@/lib/skill-library";
import { recordCreated, setPinned } from "@/lib/skill-usage";

const owner = "user_guards_a";

function seed(ref: string, options: { agent?: boolean; pinned?: boolean } = {}) {
  ensureLibraryReady(owner);
  createLibrarySkill(owner, {
    name: ref,
    content: buildSkillMarkdown(ref, "Trigger.", "Body."),
    agentAuthored: options.agent === true
  });
  if (options.pinned) {
    setPinned(owner, ref, true);
  }
  return ref;
}

function target(ref: string, name = ref): GuardTarget {
  return buildGuardTarget(owner, ref, name);
}

describe("skill-guards", () => {
  it("describes provenance in Hermes terms", () => {
    expect(describeProvenance("agent")).toBe("curator-managed");
    expect(describeProvenance("installed")).toBe("installed");
    expect(describeProvenance("learn")).toBe("user-owned");
    expect(describeProvenance(null)).toBe("user-owned");
  });

  describe("foreground writes", () => {
    it("imposes no ownership guard — user-owned skills are fully writable", () => {
      const ref = seed("user-owned");
      expect(assertOriginGuard(target(ref), "foreground", "patch")).toEqual({ ok: true });
      expect(assertOriginGuard(target(ref), "foreground", "delete")).toEqual({ ok: true });
    });

    it("blocks only deletion of a pinned skill", () => {
      const ref = seed("pinned-one", { pinned: true });
      expect(assertPinnedGuard(target(ref), "patch")).toEqual({ ok: true });
      expect(assertPinnedGuard(target(ref), "delete")).toEqual({
        ok: false,
        error: expect.stringContaining("is pinned and cannot be deleted")
      });
      expect(assertPinnedGuard(target(ref), "delete").ok).toBe(false);
    });

    it("blocks deletion of an essential skill but allows edits", () => {
      const ref = seed("agent-browser");
      expect(assertEssentialGuard(target(ref), "patch")).toEqual({ ok: true });
      expect(assertEssentialGuard(target(ref), "delete")).toEqual({
        ok: false,
        error: expect.stringContaining("is essential and cannot be deleted")
      });
    });
  });

  describe("background-review writes", () => {
    it("refuses user-owned skills with the Hermes message", () => {
      const ref = seed("user-owned-two");
      const verdict = assertOriginGuard(target(ref), "background-review", "patch");
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.error).toContain("User-owned skills are off-limits to autonomous curation.");
        expect(verdict.error).toContain(`curator adopt ${ref}`);
      }
    });

    it("allows curator-managed skills", () => {
      const ref = seed("managed-one", { agent: true });
      expect(assertOriginGuard(target(ref), "background-review", "patch")).toEqual({ ok: true });
    });

    it("refuses pinned skills as off-limits to autonomous maintenance", () => {
      const ref = seed("managed-pinned", { agent: true, pinned: true });
      const verdict = assertOriginGuard(target(ref), "background-review", "patch");
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.error).toContain("off-limits to autonomous maintenance");
      }
    });

    it("refuses essential skills", () => {
      const verdict = assertOriginGuard(
        { ...target("agent-browser"), essential: true, managed: true },
        "background-review",
        "patch"
      );
      expect(verdict.ok).toBe(false);
    });
  });

  describe("guard precedence", () => {
    it("lets pinned win over provenance on delete", () => {
      const ref = seed("pinned-unmanaged", { pinned: true });
      const verdict = evaluateSkillGuards({
        ownerUserId: owner,
        ref,
        name: ref,
        action: "delete",
        origin: "background-review"
      });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.error).toContain("is pinned");
        expect(verdict.error).not.toContain("curator-managed");
      }
    });

    it("rejects a delete without a forwarding target outside the foreground", () => {
      const ref = seed("managed-delete", { agent: true });
      const verdict = assertConsolidationDelete(target(ref), "background-review", "delete", null, false);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.error).toContain("deletes without a verified forwarding target are refused");
      }
    });

    it("requires absorbed_into to name an existing skill", () => {
      seed("managed-absorber", { agent: true });
      const ref = seed("managed-absorbed", { agent: true });
      expect(assertConsolidationDelete(target(ref), "curator", "delete", "missing-umbrella", false)).toEqual({
        ok: false,
        error: "absorbed_into 'missing-umbrella' does not name an existing skill."
      });
      expect(assertConsolidationDelete(target(ref), "curator", "delete", "managed-absorber", true)).toEqual({ ok: true });
    });

    it("never requires absorbed_into for a foreground delete", () => {
      const ref = seed("foreground-delete", { agent: true });
      expect(assertConsolidationDelete(target(ref), "foreground", "delete", null, false)).toEqual({ ok: true });
    });
  });

  describe("read-before-write", () => {
    it("is enforced only for background reviews", () => {
      expect(assertReadBeforeWrite("foreground", "any", new Set())).toEqual({ ok: true });
      expect(assertReadBeforeWrite("curator", "any", new Set())).toEqual({ ok: true });

      const verdict = assertReadBeforeWrite("background-review", "unread", new Set());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.error).toContain("has not been loaded in this review turn");
      }

      expect(assertReadBeforeWrite("background-review", "read", new Set(["read"]))).toEqual({ ok: true });
    });
  });

  describe("admin skills are read-only", () => {
    it("allows writes when the library already shadows the admin skill", () => {
      expect(assertAdminSkillsAreReadOnly("create", "anything", true)).toEqual({ ok: true });
    });

    it("passes when no admin skill matches", () => {
      expect(assertAdminSkillsAreReadOnly("create", "no-such-admin-skill", false)).toEqual({ ok: true });
    });

    it("blocks an agent write to a deployment-admin skill before any provenance complaint", async () => {
      const { createSkill } = await import("@/lib/skills");
      createSkill({ name: "pdf-extraction-admin", description: "Pull text from PDFs.", content: "Body." });
      ensureLibraryReady(owner);

      const verdict = evaluateSkillGuards({
        ownerUserId: owner,
        ref: "pdf-extraction-admin",
        name: "pdf-extraction-admin",
        action: "patch",
        origin: "background-review",
        loadedRefs: new Set(["pdf-extraction-admin"])
      });

      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.error).toContain("managed in Settings and is read-only to agents");
      }
    });
  });

  it("builds a guard target from the usage record", () => {
    const ref = seed("recorded", { agent: true, pinned: true });
    const built = target(ref);
    expect(built.managed).toBe(true);
    expect(built.pinned).toBe(true);
    expect(built.createdBy).toBe("agent");
  });

  it("treats a missing usage record as unmanaged", () => {
    ensureLibraryReady(owner);
    recordCreated(owner, "orphan", { agentCreated: false });
    expect(buildGuardTarget(owner, "orphan", "orphan").managed).toBe(false);
    expect(skillDirPath(owner, "orphan")).toContain("orphan");
  });
});
