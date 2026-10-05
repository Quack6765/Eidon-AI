import { removeLegacyBrowserState } from "@/lib/agent-computer";
import { removeOrphanedAttachmentFiles } from "@/lib/attachment-storage-recovery";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { reconcileInterruptedRuntimeState, resumeInterruptedWork } from "@/lib/interrupted-work";
import { resetStorageCleanupSchedulerForTests, startStorageCleanupScheduler } from "@/lib/storage-cleanup";

const RUNTIME_BOOTSTRAP_KEY = Symbol.for("eidon.runtime-bootstrap.completed");
const RUNTIME_RESUME_KEY = Symbol.for("eidon.runtime-bootstrap.resume");

function getBootstrapState() {
  return globalThis as typeof globalThis & {
    [RUNTIME_BOOTSTRAP_KEY]?: boolean;
    [RUNTIME_RESUME_KEY]?: string[];
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
  removeLegacyBrowserState();
  startStorageCleanupScheduler();
  state[RUNTIME_BOOTSTRAP_KEY] = true;
  state[RUNTIME_RESUME_KEY] = recovered.conversationIds;
  return { recovered, removedOrphanedAttachments };
}

export async function resumeRuntimeWork() {
  const state = getBootstrapState();
  const conversationIds = state[RUNTIME_RESUME_KEY];
  if (!conversationIds) {
    return false;
  }

  delete state[RUNTIME_RESUME_KEY];
  await resumeInterruptedWork(conversationIds);
  return true;
}

export function resetRuntimeBootstrapForTests() {
  const state = getBootstrapState();
  delete state[RUNTIME_BOOTSTRAP_KEY];
  delete state[RUNTIME_RESUME_KEY];
  resetStorageCleanupSchedulerForTests();
}
