import {
  findLibrarySkill,
  isEssentialSkillName
} from "@/lib/skill-library";
import { isCuratorManaged, getUsageRecord } from "@/lib/skill-usage";
import { listEnabledSkills } from "@/lib/skills";
import { getSkillResolvedName } from "@/lib/skill-runtime";
import type { SkillProvenance } from "@/lib/types";

export type SkillWriteOrigin = "foreground" | "background-review" | "curator";

export type SkillMutationAction =
  | "create"
  | "patch"
  | "write_file"
  | "remove_file"
  | "delete";

export type GuardTarget = {
  ref: string;
  name: string;
  createdBy: SkillProvenance;
  pinned: boolean;
  essential: boolean;
  managed: boolean;
};

export type GuardVerdict = { ok: true } | { ok: false; error: string };

const ok: GuardVerdict = { ok: true };

export function describeProvenance(createdBy: SkillProvenance) {
  if (createdBy === "agent") {
    return "curator-managed";
  }
  if (createdBy === "installed") {
    return "installed";
  }
  return "user-owned";
}

export function findAdminSkillByName(name: string) {
  const target = name.trim().toLowerCase();
  return (
    listEnabledSkills().find((skill) => getSkillResolvedName(skill).toLowerCase() === target) ?? null
  );
}

export function buildGuardTarget(ownerUserId: string | null, ref: string, name: string): GuardTarget {
  const record = getUsageRecord(ownerUserId, ref);

  return {
    ref,
    name,
    createdBy: record?.created_by ?? null,
    pinned: record?.pinned ?? false,
    essential: isEssentialSkillName(ref) || isEssentialSkillName(name),
    managed: isCuratorManaged(record)
  };
}

export function assertAdminSkillsAreReadOnly(action: SkillMutationAction, name: string, libraryHasSkill: boolean) {
  if (libraryHasSkill) {
    return ok;
  }

  const adminSkill = findAdminSkillByName(name);
  if (!adminSkill) {
    return ok;
  }

  const verb = action === "create" ? "created" : action === "delete" ? "deleted" : "changed";
  return {
    ok: false as const,
    error: `The skill "${getSkillResolvedName(adminSkill)}" is managed in Settings and is read-only to agents — it cannot be ${verb}. Ask the user to edit it there.`
  };
}

export function assertPinnedGuard(target: GuardTarget, action: SkillMutationAction): GuardVerdict {
  if (action !== "delete" || !target.pinned) {
    return ok;
  }

  return {
    ok: false,
    error: `Skill '${target.name}' is pinned and cannot be deleted. Ask the user to run 'curator unpin ${target.ref}' if they want to delete it. Patches and edits are allowed on pinned skills; only deletion is blocked.`
  };
}

export function assertEssentialGuard(target: GuardTarget, action: SkillMutationAction): GuardVerdict {
  if (action !== "delete" || !target.essential) {
    return ok;
  }

  return {
    ok: false,
    error: `Skill '${target.name}' is essential and cannot be deleted. Patches and edits are still allowed.`
  };
}

export function assertOriginGuard(target: GuardTarget, origin: SkillWriteOrigin, action: SkillMutationAction): GuardVerdict {
  if (origin === "foreground") {
    return ok;
  }

  if (target.essential) {
    return {
      ok: false,
      error: `Refusing ${origin} ${action} for essential skill '${target.name}'.`
    };
  }

  if (target.pinned) {
    return {
      ok: false,
      error: `Skill '${target.name}' is pinned and is off-limits to autonomous maintenance.`
    };
  }

  if (!target.managed && action !== "create") {
    return {
      ok: false,
      error: `Skill '${target.name}' is ${describeProvenance(target.createdBy)} and the skill is not curator-managed. User-owned skills are off-limits to autonomous curation. Run 'curator adopt ${target.ref}' to opt it in.`
    };
  }

  return ok;
}

export function assertConsolidationDelete(
  target: GuardTarget,
  origin: SkillWriteOrigin,
  action: SkillMutationAction,
  absorbedInto: string | null | undefined,
  libraryHasAbsorbingSkill: boolean
): GuardVerdict {
  if (action !== "delete" || origin === "foreground") {
    return ok;
  }
  if (!absorbedInto) {
    return {
      ok: false,
      error: `Refusing ${origin} delete of '${target.name}': deletes without a verified forwarding target are refused. Pruning is the deterministic staleness pass's job, not this one's. Pass absorbed_into=<umbrella skill> to record where the content went.`
    };
  }
  if (!libraryHasAbsorbingSkill) {
    return {
      ok: false,
      error: `absorbed_into '${absorbedInto}' does not name an existing skill.`
    };
  }

  return ok;
}

export function assertReadBeforeWrite(
  origin: SkillWriteOrigin,
  ref: string,
  loadedRefs: ReadonlySet<string>,
  fileLabel = "SKILL.md",
  action: SkillMutationAction = "patch"
): GuardVerdict {
  if (origin !== "background-review" || action === "create") {
    return ok;
  }

  if (loadedRefs.has(ref)) {
    return ok;
  }

  return {
    ok: false,
    error: `the current ${fileLabel} content has not been loaded in this review turn. Call load_skill('${ref}') first, then retry the edit.`
  };
}

export function assertPathSafety(filePath: string): GuardVerdict {
  if (filePath.includes("..") || filePath.startsWith("/")) {
    return { ok: false, error: "Path traversal ('..') is not allowed." };
  }
  return ok;
}

export type SkillGuardInput = {
  ownerUserId: string | null;
  ref: string;
  name: string;
  action: SkillMutationAction;
  origin: SkillWriteOrigin;
  absorbedInto?: string | null;
  loadedRefs?: ReadonlySet<string>;
  filePath?: string | null;
};

export function evaluateSkillGuards(input: SkillGuardInput): GuardVerdict {
  const target = buildGuardTarget(input.ownerUserId, input.ref, input.name);

  const checks: GuardVerdict[] = [
    assertPathSafety(input.filePath ?? ""),
    assertPinnedGuard(target, input.action),
    assertEssentialGuard(target, input.action),
    assertAdminSkillsAreReadOnly(
      input.action,
      input.name,
      Boolean(findLibrarySkill(input.ownerUserId, input.ref))
    ),
    assertOriginGuard(target, input.origin, input.action),
    assertConsolidationDelete(
      target,
      input.origin,
      input.action,
      input.absorbedInto,
      Boolean(input.absorbedInto && findLibrarySkill(input.ownerUserId, input.absorbedInto))
    ),
    assertReadBeforeWrite(
      input.origin,
      input.ref,
      input.loadedRefs ?? new Set(),
      input.filePath ?? "SKILL.md",
      input.action
    )
  ];

  for (const verdict of checks) {
    if (!verdict.ok) {
      return verdict;
    }
  }

  return ok;
}
