import fs from "node:fs";
import path from "node:path";

import { buildFileAttachmentPart, buildUserPromptContent } from "@/lib/compaction-prompt-building";
import { estimateTextTokens } from "@/lib/tokenization";
import type { Message, MessageAttachment } from "@/lib/types";

function createFileAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att_file",
    conversationId: "conv_1",
    messageId: "msg_1",
    filename: "archive.zip",
    mimeType: "application/zip",
    byteSize: 2048,
    sha256: "hash",
    relativePath: "conv_1/att_file_archive.zip",
    kind: "file",
    extractedText: "",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function createUserMessage(attachments: MessageAttachment[]): Pick<Message, "content" | "attachments"> {
  return {
    content: "What is in this archive?",
    attachments
  };
}

function attachmentAbsolutePath(attachment: MessageAttachment) {
  return path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath);
}

function textOf(part: ReturnType<typeof buildFileAttachmentPart>) {
  if (part.type !== "text") {
    throw new Error("expected a text part");
  }
  return part.text;
}

describe("buildFileAttachmentPart", () => {
  it("includes metadata and the absolute path when the file exists on disk", () => {
    const attachment = createFileAttachment();
    fs.mkdirSync(path.dirname(attachmentAbsolutePath(attachment)), { recursive: true });
    fs.writeFileSync(attachmentAbsolutePath(attachment), "zip-bytes");

    try {
      const text = textOf(buildFileAttachmentPart(attachment));

      expect(text).toContain("Attached file: archive.zip (application/zip, 2048 bytes)");
      expect(text).toContain(`stored at: ${attachmentAbsolutePath(attachment)}`);
      expect(text).toContain("execute_shell_command");
    } finally {
      fs.rmSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments"), {
        recursive: true,
        force: true
      });
    }
  });

  it("omits the path when the backing file is missing", () => {
    const text = textOf(buildFileAttachmentPart(createFileAttachment()));

    expect(text).toContain("Attached file: archive.zip (application/zip, 2048 bytes)");
    expect(text).not.toContain("stored at:");
    expect(text).toContain("execute_shell_command");
  });
});

describe("buildUserPromptContent file-kind attachments", () => {
  it("renders a file stub instead of the text-attachment excerpt", () => {
    const attachment = createFileAttachment();
    fs.mkdirSync(path.dirname(attachmentAbsolutePath(attachment)), { recursive: true });
    fs.writeFileSync(attachmentAbsolutePath(attachment), "zip-bytes");

    try {
      const budget = { value: 500 };
      const content = buildUserPromptContent(createUserMessage([attachment]), budget);

      const text = typeof content === "string"
        ? content
        : content
            .filter((part) => part.type === "text")
            .map((part) => part.type === "text" ? part.text : "")
            .join("\n");
      expect(text).toContain("What is in this archive?");
      expect(text).toContain("Attached file: archive.zip (application/zip, 2048 bytes)");
      expect(text).toContain(`stored at: ${attachmentAbsolutePath(attachment)}`);
      expect(text).not.toContain("[empty file]");
      expect(budget.value).toBe(500);
      expect(estimateTextTokens(text)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments"), {
        recursive: true,
        force: true
      });
    }
  });
});
