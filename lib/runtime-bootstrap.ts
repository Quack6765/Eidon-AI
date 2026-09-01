import { removeOrphanedAttachmentFiles } from "@/lib/attachment-storage-recovery";
import { getDb } from "@/lib/db";
import { reconcileInterruptedRuntimeState } from "@/lib/db-migrations";
import { env } from "@/lib/env";
import { resetStorageCleanupSchedulerForTests, startStorageCleanupScheduler } from "@/lib/storage-cleanup";

const RUNTIME_BOOTSTRAP_KEY = Symbol.for("eidon.runtime-bootstrap.completed");

function getBootstrapState() {
  return globalThis as typeof globalThis & {
    [RUNTIME_BOOTSTRAP_KEY]?: boolean;
  };
}

export function bootstrapRuntimeState() {
  const state = getBootstrapState();
  if (state[RUNTIME_BOOTSTRAP_KEY]) {
    return null;
  }

  const db = getDb();
  const recovered = reconcileInterruptedRuntimeState(db);
  const removedOrphanedAttachments = removeOrphanedAttachmentFiles(db, env.EIDON_DATA_DIR);
  startStorageCleanupScheduler();
  state[RUNTIME_BOOTSTRAP_KEY] = true;
  return { recovered, removedOrphanedAttachments };
}

export function resetRuntimeBootstrapForTests() {
  delete getBootstrapState()[RUNTIME_BOOTSTRAP_KEY];
  resetStorageCleanupSchedulerForTests();
}
