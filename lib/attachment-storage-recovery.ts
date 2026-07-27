import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

import {
  getAttachmentStorageRoot,
  resolveSafeAttachmentFilePath
} from "@/lib/attachment-storage-paths";

type StoredAttachmentRow = {
  id: string;
  relative_path: string;
  byte_size: number;
  sha256: string;
};

function hashRegularFile(absolutePath: string, expectedSize: number) {
  let descriptor: number | null = null;

  try {
    const linkStats = fs.lstatSync(absolutePath);
    if (!linkStats.isFile()) {
      return null;
    }

    const noFollowFlag = typeof fs.constants.O_NOFOLLOW === "number"
      ? fs.constants.O_NOFOLLOW
      : 0;
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | noFollowFlag);
    const stats = fs.fstatSync(descriptor);
    if (
      !stats.isFile() ||
      stats.size !== expectedSize ||
      stats.dev !== linkStats.dev ||
      stats.ino !== linkStats.ino
    ) {
      return null;
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;

    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }

    const finalDescriptorStats = fs.fstatSync(descriptor);
    const finalLinkStats = fs.lstatSync(absolutePath);
    if (
      !finalLinkStats.isFile() ||
      finalDescriptorStats.size !== expectedSize ||
      finalDescriptorStats.mtimeMs !== stats.mtimeMs ||
      finalDescriptorStats.ctimeMs !== stats.ctimeMs ||
      finalLinkStats.dev !== finalDescriptorStats.dev ||
      finalLinkStats.ino !== finalDescriptorStats.ino
    ) {
      return null;
    }

    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
    }
  }
}

export function removeOrphanedAttachmentFiles(db: Database.Database, dataDir: string) {
  const rows = db
    .prepare("SELECT id, relative_path, byte_size, sha256 FROM message_attachments")
    .all() as StoredAttachmentRow[];
  const validPaths = new Set<string>();
  const invalidIds: string[] = [];
  let root: string | null = null;

  try {
    root = getAttachmentStorageRoot(dataDir, false);
  } catch {
    root = null;
  }

  for (const row of rows) {
    let absolutePath: string | null = null;
    try {
      absolutePath = root
        ? resolveSafeAttachmentFilePath(root, row.relative_path, false)
        : null;
    } catch {
      absolutePath = null;
    }
    const actualHash = absolutePath ? hashRegularFile(absolutePath, row.byte_size) : null;

    if (!absolutePath || actualHash !== row.sha256) {
      invalidIds.push(row.id);
      continue;
    }

    validPaths.add(absolutePath);
  }

  if (invalidIds.length > 0) {
    const deleteRow = db.prepare("DELETE FROM message_attachments WHERE id = ?");
    db.transaction(() => {
      for (const attachmentId of invalidIds) {
        deleteRow.run(attachmentId);
      }
    }).immediate();
  }

  let removedArtifacts = 0;
  const directoriesToSync = new Set<string>();

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.resolve(directory, entry.name);

      if (entry.isDirectory()) {
        visit(absolutePath);
        if (fs.readdirSync(absolutePath).length === 0) {
          fs.rmdirSync(absolutePath);
          directoriesToSync.add(directory);
        }
        continue;
      }

      if (!validPaths.has(absolutePath)) {
        fs.unlinkSync(absolutePath);
        removedArtifacts += 1;
        directoriesToSync.add(directory);
      }
    }
  }

  if (root && fs.existsSync(root)) {
    visit(root);
  }

  for (const directory of directoriesToSync) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(directory, "r");
      fs.fsyncSync(descriptor);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF", "EPERM"].includes(String(code))) {
        throw error;
      }
    } finally {
      if (descriptor !== null) {
        fs.closeSync(descriptor);
      }
    }
  }

  return { invalidRecords: invalidIds.length, removedArtifacts };
}
