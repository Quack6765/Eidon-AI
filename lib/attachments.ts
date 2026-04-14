import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import { normalizeLineBreaks } from "@/lib/text-utils";
import type { AttachmentKind, MessageAttachment } from "@/lib/types";

const IMAGE_EXTENSION_TO_MIME = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

const TEXT_EXTENSION_TO_MIME = new Map<string, string>([
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".json", "application/json"],
  [".csv", "text/csv"],
  [".tsv", "text/tab-separated-values"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
  [".xml", "application/xml"],
  [".html", "text/html"],
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".jsx", "text/javascript"],
  [".ts", "text/plain"],
  [".tsx", "text/plain"],
  [".py", "text/x-python"],
  [".rb", "text/plain"],
  [".go", "text/plain"],
  [".rs", "text/plain"],
  [".java", "text/plain"],
  [".c", "text/plain"],
  [".cpp", "text/plain"],
  [".h", "text/plain"],
  [".sh", "application/x-sh"],
  [".sql", "application/sql"],
  [".toml", "application/toml"],
  [".ini", "text/plain"],
  [".log", "text/plain"]
]);

type AttachmentRow = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  relative_path: string;
  kind: AttachmentKind;
  extracted_text: string;
  created_at: string;
};

type CreateAttachmentInput = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

export class AttachmentTextPreviewUnsupportedError extends Error {
  constructor() {
    super("Attachment cannot be previewed as text");
    this.name = "AttachmentTextPreviewUnsupportedError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function getAttachmentsRoot() {
  const root = path.resolve(env.EIDON_DATA_DIR, "attachments");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function rowToAttachment(row: AttachmentRow): MessageAttachment {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    relativePath: row.relative_path,
    kind: row.kind,
    extractedText: row.extracted_text,
    createdAt: row.created_at
  };
}

function getExtension(filename: string) {
  return path.extname(filename).toLowerCase();
}

function isTextMimeType(mimeType: string) {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/yaml" ||
    mimeType === "application/x-yaml" ||
    mimeType === "application/toml" ||
    mimeType === "application/sql" ||
    mimeType === "application/javascript" ||
    mimeType === "text/javascript" ||
    mimeType === "application/x-sh"
  );
}

function sanitizeFilename(filename: string) {
  const base = path.basename(filename).replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  return base || "attachment";
}

function normalizeAttachmentKind(filename: string, mimeType: string): {
  kind: AttachmentKind;
  mimeType: string;
} {
  const extension = getExtension(filename);
  const normalizedMimeType = mimeType.toLowerCase();

  if (IMAGE_EXTENSION_TO_MIME.has(extension)) {
    return {
      kind: "image",
      mimeType: IMAGE_EXTENSION_TO_MIME.get(extension) ?? normalizedMimeType
    };
  }

  if (TEXT_EXTENSION_TO_MIME.has(extension)) {
    return {
      kind: "text",
      mimeType: TEXT_EXTENSION_TO_MIME.get(extension) ?? (normalizedMimeType || "text/plain")
    };
  }

  if (isTextMimeType(normalizedMimeType)) {
    return {
      kind: "text",
      mimeType: normalizedMimeType
    };
  }

  throw new Error(`Unsupported attachment type: ${filename}`);
}

function extractText(bytes: Buffer) {
  return normalizeLineBreaks(bytes.toString("utf8")).trim();
}

function resolveAttachmentAbsolutePath(relativePath: string) {
  return path.resolve(getAttachmentsRoot(), relativePath);
}

function ensureConversationAttachmentDir(conversationId: string) {
  const dir = path.resolve(getAttachmentsRoot(), conversationId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeConversationAttachmentDirIfEmpty(conversationId: string) {
  const dir = path.resolve(getAttachmentsRoot(), conversationId);

  if (!fs.existsSync(dir)) {
    return;
  }

  if (fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
}

function removeAttachmentFile(relativePath: string) {
  try {
    fs.unlinkSync(resolveAttachmentAbsolutePath(relativePath));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

export function getAttachment(attachmentId: string, userId?: string) {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT
            a.id,
            a.conversation_id,
            a.message_id,
            a.filename,
            a.mime_type,
            a.byte_size,
            a.sha256,
            a.relative_path,
            a.kind,
            a.extracted_text,
            a.created_at
           FROM message_attachments a
           JOIN conversations c ON c.id = a.conversation_id
           WHERE a.id = ? AND c.user_id = ?`
        )
        .get(attachmentId, userId)
    : getDb()
        .prepare(
          `SELECT
            id,
            conversation_id,
            message_id,
            filename,
            mime_type,
            byte_size,
            sha256,
            relative_path,
            kind,
            extracted_text,
            created_at
           FROM message_attachments
           WHERE id = ?`
        )
        .get(attachmentId)) as AttachmentRow | undefined;

  return row ? rowToAttachment(row) : null;
}

export function listAttachmentsForMessageIds(messageIds: string[]) {
  if (!messageIds.length) {
    return [];
  }

  const placeholders = messageIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        conversation_id,
        message_id,
        filename,
        mime_type,
        byte_size,
        sha256,
        relative_path,
        kind,
        extracted_text,
        created_at
       FROM message_attachments
       WHERE message_id IN (${placeholders})
       ORDER BY created_at ASC`
    )
    .all(...messageIds) as AttachmentRow[];

  return rows.map(rowToAttachment);
}

export function listAttachmentsForConversation(conversationId: string) {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        conversation_id,
        message_id,
        filename,
        mime_type,
        byte_size,
        sha256,
        relative_path,
        kind,
        extracted_text,
        created_at
       FROM message_attachments
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(conversationId) as AttachmentRow[];

  return rows.map(rowToAttachment);
}

export function createAttachments(conversationId: string, files: CreateAttachmentInput[]) {
  const db = getDb();
  const insertStatement = db.prepare(
    `INSERT INTO message_attachments (
      id,
      conversation_id,
      message_id,
      filename,
      mime_type,
      byte_size,
      sha256,
      relative_path,
      kind,
      extracted_text,
      created_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const dir = ensureConversationAttachmentDir(conversationId);
  const records = files.map((file) => {
    const filename = sanitizeFilename(file.filename);
    if (!filename) {
      throw new Error("Attachment filename is required");
    }

    if (!file.bytes.length) {
      throw new Error(`Attachment is empty: ${filename}`);
    }

    if (file.bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment exceeds ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB: ${filename}`);
    }

    const normalized = normalizeAttachmentKind(filename, file.mimeType);
    const id = createId("att");
    const relativePath = path.join(conversationId, `${id}_${filename}`);
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");

    return {
      id,
      conversationId,
      filename,
      mimeType: normalized.mimeType,
      byteSize: file.bytes.length,
      sha256,
      relativePath,
      kind: normalized.kind,
      extractedText: normalized.kind === "text" ? extractText(file.bytes) : "",
      createdAt: nowIso(),
      bytes: file.bytes
    };
  });

  const writtenPaths: string[] = [];

  try {
    records.forEach((record) => {
      const absolutePath = path.resolve(dir, path.basename(record.relativePath));
      fs.writeFileSync(absolutePath, record.bytes);
      writtenPaths.push(record.relativePath);
    });

    const transaction = db.transaction(() => {
      records.forEach((record) => {
        insertStatement.run(
          record.id,
          record.conversationId,
          record.filename,
          record.mimeType,
          record.byteSize,
          record.sha256,
          record.relativePath,
          record.kind,
          record.extractedText,
          record.createdAt
        );
      });
    });

    transaction();

    return records.map((record) => ({
      id: record.id,
      conversationId: record.conversationId,
      messageId: null,
      filename: record.filename,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      sha256: record.sha256,
      relativePath: record.relativePath,
      kind: record.kind,
      extractedText: record.extractedText,
      createdAt: record.createdAt
    }));
  } catch (error) {
    writtenPaths.forEach((relativePath) => {
      try {
        removeAttachmentFile(relativePath);
      } catch {}
    });
    removeConversationAttachmentDirIfEmpty(conversationId);
    throw error;
  }
}

export function assignAttachmentsToMessage(conversationId: string, messageId: string, attachmentIds: string[]) {
  if (!attachmentIds.length) {
    return [];
  }

  const placeholders = attachmentIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        conversation_id,
        message_id,
        filename,
        mime_type,
        byte_size,
        sha256,
        relative_path,
        kind,
        extracted_text,
        created_at
       FROM message_attachments
       WHERE id IN (${placeholders})`
    )
    .all(...attachmentIds) as AttachmentRow[];

  if (rows.length !== attachmentIds.length) {
    throw new Error("One or more attachments were not found");
  }

  const invalidRow = rows.find((row) => row.conversation_id !== conversationId || row.message_id !== null);

  if (invalidRow) {
    throw new Error("One or more attachments are unavailable for this message");
  }

  const statement = getDb().prepare(
    `UPDATE message_attachments
     SET message_id = ?
     WHERE id = ?`
  );

  const transaction = getDb().transaction(() => {
    attachmentIds.forEach((attachmentId) => {
      statement.run(messageId, attachmentId);
    });
  });

  transaction();

  return attachmentIds
    .map((attachmentId) => getAttachment(attachmentId))
    .filter((attachment): attachment is MessageAttachment => Boolean(attachment));
}

export function deleteAttachmentById(
  attachmentId: string,
  options?: { allowAssigned?: boolean; userId?: string }
) {
  const attachment = getAttachment(attachmentId, options?.userId);

  if (!attachment) {
    return false;
  }

  if (attachment.messageId && !options?.allowAssigned) {
    throw new Error("Attachment is already attached to a message");
  }

  removeAttachmentFile(attachment.relativePath);
  getDb().prepare("DELETE FROM message_attachments WHERE id = ?").run(attachmentId);
  removeConversationAttachmentDirIfEmpty(attachment.conversationId);
  return true;
}

export function deleteConversationAttachmentFiles(conversationId: string) {
  const attachments = listAttachmentsForConversation(conversationId);

  attachments.forEach((attachment) => {
    removeAttachmentFile(attachment.relativePath);
  });

  removeConversationAttachmentDirIfEmpty(conversationId);
}

export function resolveAttachmentPath(attachment: Pick<MessageAttachment, "relativePath">) {
  return resolveAttachmentAbsolutePath(attachment.relativePath);
}

export function readAttachmentBuffer(attachment: Pick<MessageAttachment, "relativePath">) {
  return fs.readFileSync(resolveAttachmentAbsolutePath(attachment.relativePath));
}

export function isInlineTextPreviewableAttachment(
  attachment: Pick<MessageAttachment, "kind" | "mimeType" | "filename">
) {
  if (attachment.kind !== "text") {
    return false;
  }

  try {
    return normalizeAttachmentKind(attachment.filename, attachment.mimeType).kind === "text";
  } catch {
    return false;
  }
}

export function readAttachmentText(
  attachment: Pick<MessageAttachment, "relativePath" | "kind" | "mimeType" | "filename" | "extractedText">
) {
  if (!isInlineTextPreviewableAttachment(attachment)) {
    throw new AttachmentTextPreviewUnsupportedError();
  }

  try {
    return readAttachmentBuffer(attachment).toString("utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return attachment.extractedText;
    }

    throw error;
  }
}

export function getAttachmentDataUrl(attachment: Pick<MessageAttachment, "relativePath" | "mimeType">) {
  const buffer = readAttachmentBuffer(attachment);
  return `data:${attachment.mimeType};base64,${buffer.toString("base64")}`;
}
