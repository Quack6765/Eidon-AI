import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { Folder } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function rowToFolder(row: {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}): Folder {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listFolders(userId?: string) {
  const rows = (userId
    ? getDb()
        .prepare(
          `SELECT id, name, sort_order, created_at, updated_at
           FROM folders
           WHERE user_id = ?
           ORDER BY sort_order ASC, created_at ASC`
        )
        .all(userId)
    : getDb()
        .prepare(
          `SELECT id, name, sort_order, created_at, updated_at
           FROM folders
           ORDER BY sort_order ASC, created_at ASC`
        )
        .all()) as Array<{
    id: string;
    name: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToFolder);
}

export function getFolder(folderId: string, userId?: string) {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT id, name, sort_order, created_at, updated_at
           FROM folders
           WHERE id = ? AND user_id = ?`
        )
        .get(folderId, userId)
    : getDb()
        .prepare(
          `SELECT id, name, sort_order, created_at, updated_at
           FROM folders
           WHERE id = ?`
        )
        .get(folderId)) as
    | {
        id: string;
        name: string;
        sort_order: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? rowToFolder(row) : null;
}

export function createFolder(name: string, userId?: string) {
  const timestamp = nowIso();

  const maxOrder = (userId
    ? getDb()
        .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM folders WHERE user_id = ?")
        .get(userId)
    : getDb()
        .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM folders")
        .get()) as { max_order: number };

  const folder = {
    id: createId("folder"),
    name,
    sortOrder: maxOrder.max_order + 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO folders (id, name, user_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(folder.id, folder.name, userId ?? null, folder.sortOrder, folder.createdAt, folder.updatedAt);

  return folder;
}

export function renameFolder(folderId: string, name: string, userId?: string) {
  const timestamp = nowIso();
  if (userId) {
    getDb()
      .prepare(
        `UPDATE folders SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`
      )
      .run(name, timestamp, folderId, userId);
    return;
  }

  getDb()
    .prepare(
      `UPDATE folders SET name = ?, updated_at = ? WHERE id = ?`
    )
    .run(name, timestamp, folderId);
}

export function deleteFolder(folderId: string, userId?: string) {
  if (userId) {
    getDb().prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(folderId, userId);
    return;
  }

  getDb().prepare("DELETE FROM folders WHERE id = ?").run(folderId);
}

export function getFolderConversationCount(folderId: string, userId?: string) {
  const result = (userId
    ? getDb()
        .prepare("SELECT COUNT(*) as count FROM conversations WHERE folder_id = ? AND user_id = ?")
        .get(folderId, userId)
    : getDb()
        .prepare("SELECT COUNT(*) as count FROM conversations WHERE folder_id = ?")
        .get(folderId)) as { count: number };

  return result.count;
}

export function reorderFolders(folderIds: string[], userId?: string) {
  const statement = userId
    ? getDb().prepare("UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    : getDb().prepare("UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?");

  const timestamp = nowIso();
  const transaction = getDb().transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      if (userId) {
        statement.run(index, timestamp, id, userId);
      } else {
        statement.run(index, timestamp, id);
      }
    });
  });

  transaction(folderIds);
}
