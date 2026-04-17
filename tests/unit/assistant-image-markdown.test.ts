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

  it("removes assistant-authored data image markdown from rendered prose even when attachments are empty", () => {
    const content = [
      "I've generated an image for you.",
      "",
      "![Generated Image](data:image/png;base64,Zm9v)",
      "",
      "The real attachment preview should render below."
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [])).toBe(
      [
        "I've generated an image for you.",
        "",
        "The real attachment preview should render below."
      ].join("\n")
    );
  });

  it("preserves assistant-authored data image markdown inside fenced code blocks", () => {
    const content = [
      "```md",
      "![Generated Image](data:image/png;base64,Zm9v)",
      "```",
      "",
      "![Generated Image](data:image/png;base64,Zm9v)"
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [])).toBe(
      [
        "```md",
        "![Generated Image](data:image/png;base64,Zm9v)",
        "```"
      ].join("\n")
    );
  });

  it("preserves assistant-authored data image markdown inside an unterminated fenced code block", () => {
    const content = [
      "```md",
      "![Generated Image](data:image/png;base64,Zm9v)",
      "",
      "Still part of the unfinished fence"
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [])).toBe(content);
  });

  it("does not treat a fenced line with trailing text as a closing fence", () => {
    const content = [
      "```md",
      "![Generated Image](data:image/png;base64,Zm9v)",
      "```notclose",
      "still code",
      "```",
      "",
      "[Report](notes.txt)"
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "```md",
        "![Generated Image](data:image/png;base64,Zm9v)",
        "```notclose",
        "still code",
        "```"
      ].join("\n")
    );
  });

  it("preserves assistant-authored data image markdown inside tilde fences", () => {
    const content = [
      "~~~md",
      "![Generated Image](data:image/png;base64,Zm9v)",
      "~~~",
      "",
      "[Report](notes.txt)"
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "~~~md",
        "![Generated Image](data:image/png;base64,Zm9v)",
        "~~~"
      ].join("\n")
    );
  });

  it("preserves assistant-authored data image markdown inside indented code blocks", () => {
    const content = [
      "    ![Generated Image](data:image/png;base64,Zm9v)",
      "    still code",
      "",
      "[Report](notes.txt)"
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "    ![Generated Image](data:image/png;base64,Zm9v)",
        "    still code"
      ].join("\n")
    );
  });

  it("does not treat list continuation lines as indented code blocks", () => {
    const content = ["- item", "    [Report](notes.txt)"].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe("- item");
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

  it("removes titled local markdown file links when the assistant message already has matching text attachments", () => {
    const content = [
      "Here are the reports you asked for.",
      "",
      "[Report](notes.txt \"title\")",
      "[Spaced](<notes with space.txt> \"title\")"
    ].join("\n");

    expect(
      stripAttachmentStyleImageMarkdown(content, [
        createTextAttachment(),
        createTextAttachment({
          id: "att_spaced",
          filename: "notes with space.txt",
          relativePath: "conv_test/notes with space.txt"
        })
      ])
    ).toBe("Here are the reports you asked for.");
  });

  it("strips parsed markdown targets with parentheses, angle brackets, and escaped closers when attachments match", () => {
    const content = [
      "Matched links:",
      "",
      "[Paren](file(1).txt)",
      "[Spaces](<notes with space.txt>)",
      "[Escaped](file\\)name.txt)"
    ].join("\n");

    expect(
      stripAttachmentStyleImageMarkdown(content, [
        createTextAttachment({ filename: "file(1).txt" }),
        createTextAttachment({ filename: "notes with space.txt" }),
        createTextAttachment({ filename: "file)name.txt" })
      ])
    ).toBe("Matched links:");
  });

  it("does not over-strip unrelated link suffixes", () => {
    const content = "[Maybe](es.txt)";

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment({ filename: "notes.txt" })])).toBe(content);
  });

  it("does not strip unrelated absolute paths that only share the same basename", () => {
    const content = "[Other](/tmp/other/notes.txt)";

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(content);
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

  it("preserves local markdown links inside multi-backtick inline code spans", () => {
    const content = [
      "Use the literal example ``[Report](notes.txt)`` when documenting the attachment.",
      "",
      "The prose link [Report](notes.txt) should still be stripped."
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "Use the literal example ``[Report](notes.txt)`` when documenting the attachment.",
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

  it("does not remove literal placeholder-like tokens in normal prose", () => {
    const content = [
      "The assistant can mention @@ASSISTANT_CODE_SEGMENT_0@@ literally.",
      "",
      "The prose link [Report](notes.txt) should still be stripped."
    ].join("\n");

    expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
      [
        "The assistant can mention @@ASSISTANT_CODE_SEGMENT_0@@ literally.",
        "",
        "The prose link  should still be stripped."
      ].join("\n")
    );
  });
});
