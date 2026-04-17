import { describe, expect, it } from "vitest";

import { stripAttachmentStyleImageMarkdown } from "@/lib/assistant-image-markdown";
import type { MessageAttachment } from "@/lib/types";

function createImageAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att_image",
    conversationId: "conv_test",
    messageId: "msg_assistant",
    filename: "20260416-175044-263a82d0-1.jpeg",
    mimeType: "image/jpeg",
    byteSize: 42,
    sha256: "hash",
    relativePath: "conv_test/20260416-175044-263a82d0-1.jpeg",
    kind: "image",
    extractedText: "",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function createTextAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att_text",
    conversationId: "conv_test",
    messageId: "msg_assistant",
    filename: "notes.txt",
    mimeType: "text/plain",
    byteSize: 42,
    sha256: "hash",
    relativePath: "conv_test/notes.txt",
    kind: "text",
    extractedText: "",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe("stripAttachmentStyleImageMarkdown", () => {
  it("removes local markdown image embeds when the assistant message already has image attachments", () => {
    const content = [
      "I've generated an image for you.",
      "",
      "![Generated Image](20260416-175044-263a82d0-1.jpeg)",
      "",
      "The real attachment preview should render below."
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createImageAttachment()])).toBe(
      [
        "I've generated an image for you.",
        "",
        "The real attachment preview should render below."
      ].join("\n")
    );
  });

  it("preserves external markdown images", () => {
    const content = "![Placeholder Image](https://example.com/image.png)";

    expect(stripAttachmentStyleImageMarkdown(content, [createImageAttachment()])).toBe(content);
  });

  it("removes local markdown file links when the assistant message already has text attachments", () => {
    const content = [
      "Here is the report you asked for.",
      "",
      "[Report](notes.txt)",
      "",
      "The external reference should remain: [Spec](https://example.com/spec.pdf)"
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "Here is the report you asked for.",
        "",
        "The external reference should remain: [Spec](https://example.com/spec.pdf)"
      ].join("\n")
    );
  });

  it("preserves external markdown file links", () => {
    const content = "[Spec](https://example.com/spec.pdf)";

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(content);
  });

  it("preserves local markdown links inside inline code", () => {
    const content = [
      "Use the literal example `![Diagram](notes.txt)` when documenting the attachment.",
      "",
      "The prose link [Report](notes.txt) should still be stripped."
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "Use the literal example `![Diagram](notes.txt)` when documenting the attachment.",
        "",
        "The prose link  should still be stripped."
      ].join("\n")
    );
  });

  it("preserves local markdown links inside fenced code blocks", () => {
    const content = [
      "```md",
      "[Report](notes.txt)",
      "```",
      "",
      "The prose link [Report](notes.txt) should still be stripped."
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "```md",
        "[Report](notes.txt)",
        "```",
        "",
        "The prose link  should still be stripped."
      ].join("\n")
    );
  });
});
