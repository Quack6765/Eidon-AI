import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readAttachmentBuffer } from "@/lib/attachments";
import { createConversation } from "@/lib/conversations";
import { inferAssistantLocalAttachments } from "@/lib/assistant-local-attachments";

describe("inferAssistantLocalAttachments", () => {
  it("salvages assistant-authored data image markdown into a managed attachment", () => {
    const conversation = createConversation();
    const imageBytes = Buffer.from("generated-image-bytes", "utf8");
    const dataTarget = `data:image/png;base64,${imageBytes.toString("base64")}`;

    const result = inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: ["Here is the generated image:", "", `![Generated image](${dataTarget})`].join("\n"),
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.filename).toBe("generated.png");
    expect(result.attachments[0]?.kind).toBe("image");
    expect(result.attachments[0]?.mimeType).toBe("image/png");
    expect(readAttachmentBuffer(result.attachments[0]!)).toEqual(imageBytes);
    expect(result.content).toBe("Here is the generated image:");
    expect(result.content).not.toContain(dataTarget);
    expect(result.failureNote).toBe("");
  });

  it("strips malformed assistant data image markdown and reports an attachment failure", () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";

    const result = inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: ["Here is the generated image:", "", `![Generated image](${malformedTarget})`].join("\n"),
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.content).toBe("Here is the generated image:");
    expect(result.content).not.toContain(malformedTarget);
    expect(result.failureNote).toContain("generated image");
    expect(result.failureNote).toContain("could not be imported");
  });

  it("preserves assistant data image markdown inside an unterminated fenced code block", () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";
    const content = [
      "```md",
      `![Generated image](${malformedTarget})`,
      "",
      "Still part of the unfinished fence"
    ].join("\n");

    const result = inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content,
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.content).toBe(content);
    expect(result.failureNote).toBe("");
  });

  it("imports a /tmp image markdown target and strips it from content", () => {
    const conversation = createConversation();
    const tempDir = fs.mkdtempSync(path.join("/tmp", "eidon-assistant-image-"));
    const sourcePath = path.join(tempDir, "preview.png");

    try {
      fs.writeFileSync(sourcePath, "png-binary", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Preview:", "", `![preview](${sourcePath})`].join("\n"),
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("preview.png");
      expect(result.attachments[0]?.kind).toBe("image");
      expect(result.content).toBe("Preview:");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("imports a workspace markdown link and strips it from content", () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "workspace-log.txt");

    try {
      fs.writeFileSync(sourcePath, "hello from workspace", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached log:", "", `[log](${sourcePath})`].join("\n"),
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("workspace-log.txt");
      expect(result.content).toBe("Attached log:");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("denies out-of-bounds local paths with a user-facing note", () => {
    const conversation = createConversation();
    const outsideDir = fs.mkdtempSync(path.join(os.homedir(), ".eidon-out-of-bounds-"));
    const outsidePath = path.join(outsideDir, "secret.txt");

    try {
      fs.writeFileSync(outsidePath, "top secret", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: `[secret](${outsidePath})`,
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe("");
      expect(result.failureNote).toContain("only workspace files and /tmp are allowed");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("ignores external URLs", () => {
    const conversation = createConversation();
    const content = "See [docs](https://example.com/spec.pdf)";

    const result = inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content,
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.content).toBe(content);
    expect(result.failureNote).toBe("");
  });

  it("ignores relative paths", () => {
    const conversation = createConversation();
    const content = "See [notes](./notes.txt)";

    const result = inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content,
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.content).toBe(content);
    expect(result.failureNote).toBe("");
  });

  it("imports an angle-bracket local path with spaces", () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "notes with space.txt");

    try {
      fs.writeFileSync(sourcePath, "spacey", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[notes](<${sourcePath}>)`].join("\n"),
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports a local path containing parentheses", () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "file(1).txt");

    try {
      fs.writeFileSync(sourcePath, "paren", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[file](${sourcePath})`].join("\n"),
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports a local path with an escaped closing parenthesis", () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "file)name.txt");

    try {
      fs.writeFileSync(sourcePath, "escaped paren", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[file](${sourcePath.replace(")", "\\)")})`].join("\n"),
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports an angle-bracket local path with an escaped closing angle bracket", () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "file>name.txt");

    try {
      fs.writeFileSync(sourcePath, "escaped angle", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[file](<${sourcePath.replace(">", "\\>")}>)`].join("\n"),
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes after canonicalization", () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const outsideDir = fs.mkdtempSync(path.join(os.homedir(), ".eidon-symlink-escape-"));
    const outsidePath = path.join(outsideDir, "private.txt");
    const symlinkPath = path.join(workspaceDir, "private-link.txt");

    try {
      fs.writeFileSync(outsidePath, "private", "utf8");
      fs.symlinkSync(outsidePath, symlinkPath);

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: `[private](${symlinkPath})`,
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe("");
      expect(result.failureNote).toContain("only workspace files and /tmp are allowed");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("denies default app-data paths even when EIDON_DATA_DIR is unset", () => {
    const conversation = createConversation();
    const previousDataDir = process.env.EIDON_DATA_DIR;
    const defaultAppDataDir = path.resolve(".data");
    const sourcePath = path.join(defaultAppDataDir, "assistant-private.txt");

    try {
      delete process.env.EIDON_DATA_DIR;
      fs.mkdirSync(defaultAppDataDir, { recursive: true });
      fs.writeFileSync(sourcePath, "private app data", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: `[private](${sourcePath})`,
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe("");
      expect(result.failureNote).toContain("only workspace files and /tmp are allowed");
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.EIDON_DATA_DIR;
      } else {
        process.env.EIDON_DATA_DIR = previousDataDir;
      }
      fs.rmSync(defaultAppDataDir, { recursive: true, force: true });
    }
  });

  it("deduplicates duplicate references to the same local file", () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "duplicate.txt");

    try {
      fs.writeFileSync(sourcePath, "duplicate", "utf8");

      const result = inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["First [copy](" + sourcePath + ")", "", "Second [copy](" + sourcePath + ")"].join("\n"),
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.content).toBe("First\n\nSecond");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
