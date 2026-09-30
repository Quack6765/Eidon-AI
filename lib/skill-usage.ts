import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { getUsageFilePath } from "@/lib/skill-paths";
import { nowIso } from "@/lib/utils";
import type { SkillLifecycleState, SkillProvenance, SkillUsage } from "@/lib/types";

export const STATE_ACTIVE = "active";
export const STATE_STALE = "stale";
export const STATE_ARCHIVED = "archived";

export const CREATED_BY_AGENT = "agent";
export const CREATED_BY_LEARN = "learn";
export const CREATED_BY_INSTALLED = "installed";

export type SkillUsageRecord = {
  created_by: SkillProvenance;
  use_count: number;
  view_count: number;
  last_used_at: string | null;
  last_viewed_at: string | null;
  patch_count: number;
  patch_generation: number;
  last_reused_patch_generation: number;
  last_patched_at: string | null;
  created_at: string;
  state: SkillLifecycleState;
  pinned: boolean;
  archived_at: string | null;
  first_seen_at?: string;
};

export type SkillUsageIndex = Record<string, SkillUsageRecord>;

function emptyRecord(timestamp = nowIso()): SkillUsageRecord {
  return {
    created_by: null,
    use_count: 0,
    view_count: 0,
    last_used_at: null,
    last_viewed_at: null,
    patch_count: 0,
    patch_generation: 0,
    last_reused_patch_generation: 0,
    last_patched_at: null,
    created_at: timestamp,
    state: STATE_ACTIVE,
    pinned: false,
    archived_at: null
  };
}

function backfill(record: unknown): SkillUsageRecord {
  if (!record || typeof record !== "object") {
    return emptyRecord();
  }

  const base = emptyRecord();
  const source = record as Partial<SkillUsageRecord>;
  const merged: SkillUsageRecord = { ...base };

  for (const key of Object.keys(base) as Array<keyof SkillUsageRecord>) {
    const value = source[key];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  if (typeof source.first_seen_at === "string") {
    merged.first_seen_at = source.first_seen_at;
  }

  return merged;
}

export function readUsageIndex(ownerUserId: string | null): SkillUsageIndex {
  const usageFile = getUsageFilePath(ownerUserId);
  if (!existsSync(usageFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(usageFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const index: SkillUsageIndex = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      index[key] = backfill(value);
    }
    return index;
  } catch {
    return {};
  }
}

function writeUsageIndex(ownerUserId: string | null, index: SkillUsageIndex) {
  const usageFile = getUsageFilePath(ownerUserId);
  mkdirSync(dirname(usageFile), { recursive: true });
  const tempFile = `${usageFile}.${process.pid}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  renameSync(tempFile, usageFile);
}

function mutate(
  ownerUserId: string | null,
  skillRef: string,
  change: (record: SkillUsageRecord) => void,
  options: { createIfMissing?: boolean; timestamp?: string } = {}
): SkillUsageRecord | null {
  const index = readUsageIndex(ownerUserId);
  let record = index[skillRef];

  if (!record) {
    if (!options.createIfMissing) {
      return null;
    }
    record = emptyRecord(options.timestamp ?? nowIso());
    record.first_seen_at = record.created_at;
    index[skillRef] = record;
  }

  change(record);
  writeUsageIndex(ownerUserId, index);
  return record;
}

export function getUsageRecord(ownerUserId: string | null, skillRef: string) {
  return readUsageIndex(ownerUserId)[skillRef] ?? null;
}

export function recordCreated(
  ownerUserId: string | null,
  skillRef: string,
  options: { agentCreated: boolean; timestamp?: string }
) {
  const timestamp = options.timestamp ?? nowIso();
  return mutate(
    ownerUserId,
    skillRef,
    (record) => {
      record.created_by = options.agentCreated ? CREATED_BY_AGENT : CREATED_BY_LEARN;
      record.created_at = timestamp;
      record.state = STATE_ACTIVE;
    },
    { createIfMissing: true, timestamp }
  );
}

export function recordInstalled(ownerUserId: string | null, skillRef: string) {
  return mutate(
    ownerUserId,
    skillRef,
    (record) => {
      record.created_by = CREATED_BY_INSTALLED;
    },
    { createIfMissing: true }
  );
}

export function adoptSkill(ownerUserId: string | null, skillRef: string) {
  const record = mutate(ownerUserId, skillRef, (row) => {
    row.created_by = CREATED_BY_AGENT;
  }, { createIfMissing: true });

  return record;
}

export function setPinned(ownerUserId: string | null, skillRef: string, pinned: boolean) {
  return mutate(ownerUserId, skillRef, (row) => {
    row.pinned = pinned;
  }, { createIfMissing: true });
}

export function bumpUse(ownerUserId: string | null, skillRef: string) {
  const timestamp = nowIso();
  return mutate(ownerUserId, skillRef, (row) => {
    row.use_count += 1;
    row.last_used_at = timestamp;
  }, { createIfMissing: true, timestamp });
}

export function bumpView(ownerUserId: string | null, skillRef: string) {
  const timestamp = nowIso();
  return mutate(ownerUserId, skillRef, (row) => {
    row.view_count += 1;
    row.last_viewed_at = timestamp;
  }, { createIfMissing: true, timestamp });
}

export function bumpPatch(ownerUserId: string | null, skillRef: string) {
  const timestamp = nowIso();
  return mutate(ownerUserId, skillRef, (row) => {
    row.patch_count += 1;
    row.patch_generation += 1;
    row.last_patched_at = timestamp;
  }, { createIfMissing: true, timestamp });
}

export function markArchived(ownerUserId: string | null, skillRef: string) {
  const timestamp = nowIso();
  return mutate(ownerUserId, skillRef, (row) => {
    row.state = STATE_ARCHIVED;
    row.archived_at = timestamp;
  }, { createIfMissing: true, timestamp });
}

export function markRestored(ownerUserId: string | null, skillRef: string) {
  return mutate(ownerUserId, skillRef, (row) => {
    row.state = STATE_ACTIVE;
    row.archived_at = null;
  }, { createIfMissing: true });
}

export function markLifecycleState(ownerUserId: string | null, skillRef: string, state: SkillLifecycleState) {
  return mutate(ownerUserId, skillRef, (row) => {
    row.state = state;
  }, { createIfMissing: true });
}

export function forgetUsage(ownerUserId: string | null, skillRef: string) {
  const index = readUsageIndex(ownerUserId);
  if (!(skillRef in index)) {
    return false;
  }
  delete index[skillRef];
  writeUsageIndex(ownerUserId, index);
  return true;
}

export function latestActivityAt(record: SkillUsageRecord): string | null {
  const candidates = [record.last_used_at, record.last_viewed_at, record.last_patched_at].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  if (!candidates.length) {
    return null;
  }

  return candidates.sort().at(-1) ?? null;
}

export function activityAnchor(record: SkillUsageRecord, fallback: string): string {
  return latestActivityAt(record) ?? record.created_at ?? fallback;
}

export function activityCount(record: SkillUsageRecord) {
  return record.use_count + record.view_count + record.patch_count;
}

export function isCuratorManaged(record: SkillUsageRecord | null) {
  if (!record) {
    return false;
  }
  return record.created_by === CREATED_BY_AGENT;
}

export function toSkillUsage(record: SkillUsageRecord | null): SkillUsage {
  return {
    useCount: record?.use_count ?? 0,
    viewCount: record?.view_count ?? 0,
    lastUsedAt: record?.last_used_at ?? null,
    lastViewedAt: record?.last_viewed_at ?? null,
    patchCount: record?.patch_count ?? 0,
    lastPatchedAt: record?.last_patched_at ?? null
  };
}

export function toSkillProvenance(record: SkillUsageRecord | null): SkillProvenance {
  return record?.created_by ?? null;
}
