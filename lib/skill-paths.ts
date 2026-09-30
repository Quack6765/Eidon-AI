import { join } from "node:path";

import { getBotTeamWorkspacesDir } from "@/lib/bot-sandbox";

export const USAGE_FILE_NAME = ".usage.json";
export const ARCHIVE_DIR_NAME = ".archive";
export const LOCKS_DIR_NAME = ".locks";
export const LEDGER_FILE_NAME = ".curator_ledger.jsonl";
export const CURATOR_STATE_FILE_NAME = ".curator_state";
export const CURATOR_BACKUPS_DIR_NAME = ".curator_backups";
export const MIGRATION_MARKER_NAME = ".migrated";

export function getSkillLibraryDir(ownerUserId: string | null) {
  return join(getBotTeamWorkspacesDir({ userId: ownerUserId }), "shared", "skills");
}

export function getUsageFilePath(ownerUserId: string | null) {
  return join(getSkillLibraryDir(ownerUserId), USAGE_FILE_NAME);
}

export function getArchiveDir(ownerUserId: string | null) {
  return join(getSkillLibraryDir(ownerUserId), ARCHIVE_DIR_NAME);
}

export function getLocksDir(ownerUserId: string | null) {
  return join(getSkillLibraryDir(ownerUserId), LOCKS_DIR_NAME);
}

export function getLedgerFilePath(ownerUserId: string | null) {
  return join(getSkillLibraryDir(ownerUserId), LEDGER_FILE_NAME);
}

export function getCuratorStateFilePath(ownerUserId: string | null) {
  return join(getSkillLibraryDir(ownerUserId), CURATOR_STATE_FILE_NAME);
}

export function getCuratorBackupsDir(ownerUserId: string | null) {
  return join(getSkillLibraryDir(ownerUserId), CURATOR_BACKUPS_DIR_NAME);
}

export function getMigrationMarkerPath(ownerUserId: string | null) {
  return join(getSkillLibraryDir(ownerUserId), MIGRATION_MARKER_NAME);
}

export const SKILL_STATE_ENTRIES = [
  USAGE_FILE_NAME,
  ARCHIVE_DIR_NAME,
  LOCKS_DIR_NAME,
  LEDGER_FILE_NAME,
  CURATOR_STATE_FILE_NAME,
  CURATOR_BACKUPS_DIR_NAME,
  MIGRATION_MARKER_NAME
];
