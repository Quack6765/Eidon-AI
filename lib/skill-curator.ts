import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { env } from "@/lib/env";

import {
  archiveLibrarySkill,
  discoverLibrarySkillRefs,
  isEssentialSkillName,
  listArchivedSkills,
  pruneSnapshots,
  skillRefLeaf,
  snapshotLibrary
} from "@/lib/skill-library";
import { getArchiveDir, getCuratorStateFilePath } from "@/lib/skill-paths";
import {
  activityAnchor,
  getUsageRecord,
  isCuratorManaged,
  markLifecycleState,
  STATE_ACTIVE,
  STATE_ARCHIVED,
  STATE_STALE
} from "@/lib/skill-usage";
import { nowIso } from "@/lib/utils";
import type { SkillLifecycleState } from "@/lib/types";

export type SkillCuratorConfig = {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
  consolidate: boolean;
  pruneBuiltins: boolean;
  archiveTtlDays: number;
  backup: { enabled: boolean; keep: number };
  backgroundReview: { enabled: boolean };
  ledger: boolean;
};

export const DEFAULT_SKILL_CURATOR_CONFIG: SkillCuratorConfig = {
  enabled: true,
  intervalHours: 24 * 7,
  minIdleHours: 2,
  staleAfterDays: 14,
  archiveAfterDays: 30,
  consolidate: false,
  pruneBuiltins: true,
  archiveTtlDays: 0,
  backup: { enabled: true, keep: 5 },
  backgroundReview: { enabled: true },
  ledger: true
};

export const CURATOR_DRY_RUN_BANNER = "DRY-RUN — REPORT ONLY. DO NOT MUTATE THE SKILL LIBRARY.";

const CURATOR_CONFIG_FILE = "skill-curator-config.json";

function curatorConfigPath() {
  return join(env.EIDON_DATA_DIR, CURATOR_CONFIG_FILE);
}

function cloneConfig(config: SkillCuratorConfig): SkillCuratorConfig {
  return {
    ...config,
    backup: { ...config.backup },
    backgroundReview: { ...config.backgroundReview }
  };
}

export function getCuratorConfig(): SkillCuratorConfig {
  const path = curatorConfigPath();
  if (!existsSync(path)) {
    return cloneConfig(DEFAULT_SKILL_CURATOR_CONFIG);
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SkillCuratorConfig>;
    return {
      ...DEFAULT_SKILL_CURATOR_CONFIG,
      ...parsed,
      backup: { ...DEFAULT_SKILL_CURATOR_CONFIG.backup, ...(parsed.backup ?? {}) },
      backgroundReview: {
        ...DEFAULT_SKILL_CURATOR_CONFIG.backgroundReview,
        ...(parsed.backgroundReview ?? {})
      }
    };
  } catch {
    return cloneConfig(DEFAULT_SKILL_CURATOR_CONFIG);
  }
}

export type SkillCuratorConfigPatch = {
  enabled?: boolean;
  intervalHours?: number;
  minIdleHours?: number;
  staleAfterDays?: number;
  archiveAfterDays?: number;
  consolidate?: boolean;
  pruneBuiltins?: boolean;
  archiveTtlDays?: number;
  backup?: { enabled?: boolean; keep?: number };
  backgroundReview?: { enabled?: boolean };
  ledger?: boolean;
};

export function updateCuratorConfig(patch: SkillCuratorConfigPatch) {
  const current = getCuratorConfig();
  const next = {
    ...current,
    ...patch,
    backup: { ...current.backup, ...(patch.backup ?? {}) },
    backgroundReview: { ...current.backgroundReview, ...(patch.backgroundReview ?? {}) }
  };
  writeFileSync(curatorConfigPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return cloneConfig(next);
}

export const CURATOR_INVARIANTS = [
  "Invariants: only curator-managed skills are touched; never delete, only archive (recoverable); pinned skills bypass all auto-transitions."
];

export type CuratorState = {
  seededAt: string;
  lastRunAt: string | null;
  lastInteractionAt: string | null;
  paused: boolean;
  lastSummary: string | null;
};

function emptyCuratorState(): CuratorState {
  return {
    seededAt: nowIso(),
    lastRunAt: null,
    lastInteractionAt: null,
    paused: false,
    lastSummary: null
  };
}

export function readCuratorState(ownerUserId: string | null): CuratorState {
  const stateFile = getCuratorStateFilePath(ownerUserId);
  if (!existsSync(stateFile)) {
    return emptyCuratorState();
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<CuratorState>;
    return {
      seededAt: typeof parsed.seededAt === "string" ? parsed.seededAt : nowIso(),
      lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : null,
      lastInteractionAt: typeof parsed.lastInteractionAt === "string" ? parsed.lastInteractionAt : null,
      paused: parsed.paused === true,
      lastSummary: typeof parsed.lastSummary === "string" ? parsed.lastSummary : null
    };
  } catch {
    return emptyCuratorState();
  }
}

export function writeCuratorState(ownerUserId: string | null, state: CuratorState) {
  const stateFile = getCuratorStateFilePath(ownerUserId);
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function touchCuratorActivity(ownerUserId: string | null) {
  const state = readCuratorState(ownerUserId);
  state.lastInteractionAt = nowIso();
  writeCuratorState(ownerUserId, state);
  return state;
}

export function setCuratorPaused(ownerUserId: string | null, paused: boolean) {
  const state = readCuratorState(ownerUserId);
  state.paused = paused;
  writeCuratorState(ownerUserId, state);
  return state;
}

export type CuratorScheduleVerdict =
  | { run: true }
  | { run: false; reason: "disabled" | "paused" | "first-run-deferred" | "not-due" | "not-idle" };

export function shouldRunCurator(
  state: CuratorState,
  config: SkillCuratorConfig,
  now: Date,
  lastInteractionAt: string | null
): CuratorScheduleVerdict {
  if (!config.enabled) {
    return { run: false, reason: "disabled" };
  }
  if (state.paused) {
    return { run: false, reason: "paused" };
  }
  if (!state.lastRunAt) {
    return { run: false, reason: "first-run-deferred" };
  }

  const lastRunMs = Date.parse(state.lastRunAt);
  if (!Number.isFinite(lastRunMs) || now.getTime() - lastRunMs < config.intervalHours * 3_600_000) {
    return { run: false, reason: "not-due" };
  }

  if (lastInteractionAt) {
    const lastInteractionMs = Date.parse(lastInteractionAt);
    if (Number.isFinite(lastInteractionMs) && now.getTime() - lastInteractionMs < config.minIdleHours * 3_600_000) {
      return { run: false, reason: "not-idle" };
    }
  }

  return { run: true };
}

export function seedCuratorState(ownerUserId: string | null) {
  const state = readCuratorState(ownerUserId);
  if (!state.lastRunAt) {
    state.lastRunAt = nowIso();
    writeCuratorState(ownerUserId, state);
  }
  return state;
}

export type TransitionResult = {
  ref: string;
  from: SkillLifecycleState;
  to: SkillLifecycleState;
  action: "stale" | "archive" | "revive";
};

export function applyAutomaticTransitions(
  ownerUserId: string | null,
  config: SkillCuratorConfig,
  now: Date = new Date(),
  options: { dryRun?: boolean } = {}
): TransitionResult[] {
  const results: TransitionResult[] = [];
  const nowIsoValue = now.toISOString();
  const staleCutoff = new Date(now.getTime() - config.staleAfterDays * 86_400_000).toISOString();
  const archiveCutoff = new Date(now.getTime() - config.archiveAfterDays * 86_400_000).toISOString();

  for (const ref of discoverLibrarySkillRefs(ownerUserId)) {
    const record = getUsageRecord(ownerUserId, ref);
    if (!record) {
      continue;
    }
    if (!isCuratorManaged(record)) {
      continue;
    }
    if (record.pinned) {
      continue;
    }
    if (isEssentialSkillName(skillRefLeaf(ref))) {
      continue;
    }
    if (record.state === STATE_ARCHIVED) {
      continue;
    }

    const anchor = activityAnchor(record, nowIsoValue);
    const current = record.state;

    if (anchor <= archiveCutoff) {
      if (!options.dryRun) {
        archiveLibrarySkill(ownerUserId, ref);
      }
      results.push({ ref, from: current, to: STATE_ARCHIVED, action: "archive" });
      continue;
    }

    if (anchor <= staleCutoff) {
      if (current === STATE_ACTIVE) {
        if (!options.dryRun) {
          markLifecycleState(ownerUserId, ref, STATE_STALE);
        }
        results.push({ ref, from: current, to: STATE_STALE, action: "stale" });
      }
      continue;
    }

    if (current === STATE_STALE) {
      if (!options.dryRun) {
        markLifecycleState(ownerUserId, ref, STATE_ACTIVE);
      }
      results.push({ ref, from: current, to: STATE_ACTIVE, action: "revive" });
    }
  }

  return results;
}

export type CuratorPassResult = {
  transitions: TransitionResult[];
  purged: string[];
  prunedSnapshots: string[];
  snapshot: string | null;
  summary: string;
  dryRun: boolean;
};

export function runCuratorPass(
  ownerUserId: string | null,
  config: SkillCuratorConfig = DEFAULT_SKILL_CURATOR_CONFIG,
  options: { dryRun?: boolean } = {}
): CuratorPassResult {
  const dryRun = options.dryRun === true;
  const snapshot = config.backup.enabled && !dryRun ? snapshotLibrary(ownerUserId, "pre-curator-run") : null;
  const transitions = applyAutomaticTransitions(ownerUserId, config, new Date(), { dryRun });
  const purged = dryRun ? [] : purgeArchived(ownerUserId, config);
  const prunedSnapshots = config.backup.enabled && !dryRun ? pruneSnapshots(ownerUserId, config.backup.keep) : [];

  const archived = transitions.filter((entry) => entry.action === "archive").length;
  const stale = transitions.filter((entry) => entry.action === "stale").length;
  const revived = transitions.filter((entry) => entry.action === "revive").length;
  const summary = [
    dryRun ? CURATOR_DRY_RUN_BANNER : null,
    `Curator: ${archived} archived, ${stale} marked stale, ${revived} revived, ${purged.length} purged.`
  ]
    .filter(Boolean)
    .join("\n");

  if (!dryRun) {
    const state = readCuratorState(ownerUserId);
    state.lastRunAt = nowIso();
    state.lastSummary = summary;
    writeCuratorState(ownerUserId, state);
  }

  return { transitions, purged, prunedSnapshots, snapshot, summary, dryRun };
}

export function purgeArchived(ownerUserId: string | null, config: SkillCuratorConfig) {
  if (config.archiveTtlDays <= 0) {
    return [];
  }

  const archiveRoot = getArchiveDir(ownerUserId);
  const cutoff = Date.now() - config.archiveTtlDays * 86_400_000;
  const purged: string[] = [];

  for (const name of listArchivedSkills(ownerUserId)) {
    const path = join(archiveRoot, name);
    try {
      if (statSync(path).mtimeMs <= cutoff) {
        rmSync(path, { recursive: true, force: true });
        purged.push(name);
      }
    } catch {
      // already gone
    }
  }

  return purged;
}

export function listCuratorEligibleRefs(ownerUserId: string | null) {
  return discoverLibrarySkillRefs(ownerUserId).filter((ref) => {
    const record = getUsageRecord(ownerUserId, ref);
    return isCuratorManaged(record) && !record?.pinned && !isEssentialSkillName(skillRefLeaf(ref));
  });
}
