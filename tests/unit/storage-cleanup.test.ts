import fs from "node:fs";
import path from "node:path";

import {
  bindAttachmentsToMessage,
  createAttachments,
  getAttachment
} from "@/lib/attachments";
import { createConversation, createMessage } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getGlobalPreferences } from "@/lib/global-preferences";
import {
  UNSENT_ATTACHMENT_TTL_MS,
  enforceConversationRetention,
  pruneUnsentAttachments,
  resetStorageCleanupSchedulerForTests,
  runStorageCleanup,
  startStorageCleanupScheduler
} from "@/lib/storage-cleanup";
import { updateUserPreferences } from "@/lib/user-preferences";
import { createLocalUser } from "@/lib/users";

const DAY_MS = 24 * 60 * 60 * 1000;

function backdateAttachment(attachmentId: string, ageMs: number) {
  getDb()
    .prepare("UPDATE message_attachments SET created_at = ? WHERE id = ?")
    .run(new Date(Date.now() - ageMs).toISOString(), attachmentId);
}

function backdateConversation(conversationId: string, ageMs: number) {
  getDb()
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - ageMs).toISOString(), conversationId);
}

function attachmentFilePath(relativePath: string) {
  return path.resolve(process.env.EIDON_DATA_DIR!, "attachments", relativePath);
}

function conversationExists(conversationId: string) {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS count FROM conversations WHERE id = ?")
      .get(conversationId) as { count: number }
  ).count > 0;
}

describe("pruneUnsentAttachments", () => {
  it("prunes unsent attachments past the TTL while keeping bound and fresh ones", async () => {
    const conversation = createConversation();
    const [staleUnsent, freshUnsent, bound] = await createAttachments(conversation.id, [
      { filename: "stale.zip", mimeType: "application/zip", bytes: Buffer.from("stale") },
      { filename: "fresh.zip", mimeType: "application/zip", bytes: Buffer.from("fresh") },
      { filename: "bound.zip", mimeType: "application/zip", bytes: Buffer.from("bound") }
    ]);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Here"
    });
    bindAttachmentsToMessage(conversation.id, message.id, [bound.id]);

    backdateAttachment(staleUnsent.id, UNSENT_ATTACHMENT_TTL_MS + DAY_MS);
    backdateAttachment(bound.id, UNSENT_ATTACHMENT_TTL_MS + DAY_MS);

    const result = pruneUnsentAttachments();

    expect(result).toEqual({ prunedAttachments: 1 });
    expect(getAttachment(staleUnsent.id)).toBeNull();
    expect(fs.existsSync(attachmentFilePath(staleUnsent.relativePath))).toBe(false);
    expect(getAttachment(freshUnsent.id)).not.toBeNull();
    expect(fs.existsSync(attachmentFilePath(freshUnsent.relativePath))).toBe(true);
    expect(getAttachment(bound.id)).not.toBeNull();
    expect(fs.existsSync(attachmentFilePath(bound.relativePath))).toBe(true);
  });
});

describe("enforceConversationRetention", () => {
  it("deletes old conversations of retention-limited users and keeps forever users untouched", async () => {
    const retentionUser = await createLocalUser({
      username: "retention-user",
      password: "Password123!",
      role: "user"
    });
    const foreverUser = await createLocalUser({
      username: "forever-user",
      password: "Password123!",
      role: "user"
    });
    updateUserPreferences(retentionUser.id, getGlobalPreferences(), {
      conversationRetention: "7d"
    });

    const expiredConversation = createConversation(
      "Expired",
      null,
      undefined,
      retentionUser.id
    );
    const recentConversation = createConversation(
      "Recent",
      null,
      undefined,
      retentionUser.id
    );
    const foreverConversation = createConversation(
      "Old forever",
      null,
      undefined,
      foreverUser.id
    );

    const [expiredAttachment] = await createAttachments(expiredConversation.id, [
      { filename: "gone.zip", mimeType: "application/zip", bytes: Buffer.from("gone") }
    ]);
    const [recentAttachment] = await createAttachments(recentConversation.id, [
      { filename: "kept.zip", mimeType: "application/zip", bytes: Buffer.from("kept") }
    ]);
    const [foreverAttachment] = await createAttachments(foreverConversation.id, [
      { filename: "forever.zip", mimeType: "application/zip", bytes: Buffer.from("forever") }
    ]);

    backdateConversation(expiredConversation.id, 10 * DAY_MS);
    backdateConversation(foreverConversation.id, 10 * DAY_MS);

    const result = enforceConversationRetention();

    expect(result.prunedConversations).toBe(1);
    expect(conversationExists(expiredConversation.id)).toBe(false);
    expect(fs.existsSync(attachmentFilePath(expiredAttachment.relativePath))).toBe(false);
    expect(conversationExists(recentConversation.id)).toBe(true);
    expect(fs.existsSync(attachmentFilePath(recentAttachment.relativePath))).toBe(true);
    expect(conversationExists(foreverConversation.id)).toBe(true);
    expect(fs.existsSync(attachmentFilePath(foreverAttachment.relativePath))).toBe(true);
  });
});

describe("runStorageCleanup", () => {
  it("combines the unsent-attachment and retention sweeps", async () => {
    const user = await createLocalUser({
      username: "combined-user",
      password: "Password123!",
      role: "user"
    });
    updateUserPreferences(user.id, getGlobalPreferences(), {
      conversationRetention: "7d"
    });

    const staleConversation = createConversation("Stale", null, undefined, user.id);
    const [staleAttachment] = await createAttachments(staleConversation.id, [
      { filename: "stale.zip", mimeType: "application/zip", bytes: Buffer.from("stale") }
    ]);
    const liveConversation = createConversation("Live", null, undefined, user.id);
    const [liveAttachment] = await createAttachments(liveConversation.id, [
      { filename: "live.zip", mimeType: "application/zip", bytes: Buffer.from("live") }
    ]);

    backdateAttachment(staleAttachment.id, UNSENT_ATTACHMENT_TTL_MS + DAY_MS);
    backdateConversation(staleConversation.id, 10 * DAY_MS);
    backdateConversation(liveConversation.id, 0);

    const result = runStorageCleanup();

    expect(result.prunedAttachments).toBe(1);
    expect(result.prunedConversations).toBe(1);
    expect(conversationExists(liveConversation.id)).toBe(true);
    expect(fs.existsSync(attachmentFilePath(liveAttachment.relativePath))).toBe(true);
  });
});

describe("startStorageCleanupScheduler", () => {
  it("starts at most once per process", () => {
    resetStorageCleanupSchedulerForTests();
    try {
      expect(startStorageCleanupScheduler()).toBe(true);
      expect(startStorageCleanupScheduler()).toBe(false);
    } finally {
      resetStorageCleanupSchedulerForTests();
    }
  });
});
