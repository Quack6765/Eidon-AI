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
});
