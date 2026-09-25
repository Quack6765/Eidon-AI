import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readAttachmentBuffer } from "@/lib/attachments";
import { createConversation } from "@/lib/conversations";
import {
  appendDeliveredFileLinks,
  formatMarkdownFileLink,
  inferAssistantLocalAttachments
} from "@/lib/assistant-local-attachments";
import type { MessageAttachment } from "@/lib/types";

describe("inferAssistantLocalAttachments", () => {
  it("salvages assistant-authored data image markdown into a managed attachment", async () => {
    const conversation = createConversation();
    const imageBytes = Buffer.from("generated-image-bytes", "utf8");
    const dataTarget = `data:image/png;base64,${imageBytes.toString("base64")}`;

    const result = await inferAssistantLocalAttachments({
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

  it("strips malformed assistant data image markdown and reports an attachment failure", async () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";

    const result = await inferAssistantLocalAttachments({
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

  it("preserves assistant data image markdown inside an unterminated fenced code block", async () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";
    const content = [
      "```md",
      `![Generated image](${malformedTarget})`,
      "",
      "Still part of the unfinished fence"
    ].join("\n");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content,
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.content).toBe(content);
    expect(result.failureNote).toBe("");
  });

  it("preserves assistant data image markdown inside a list-indented fenced code block", async () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");

    try {
      fs.writeFileSync(sourcePath, "report", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: [
          "- item",
          "",
          "  ```md",
          `  ![Generated image](${malformedTarget})`,
          "  ```",
          "",
          `[report](${sourcePath})`
        ].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("report.txt");
      expect(result.content).toBe("- item\n\n  ```md\n  ![Generated image](data:image/png;base64,%%%)\n  ```\n\nreport");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves assistant data image markdown inside an unterminated blockquoted fenced code block", async () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");

    try {
      fs.writeFileSync(sourcePath, "report", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["> ```md", `> ![Generated image](${malformedTarget})`, "> still code", "", `[report](${sourcePath})`].join(
          "\n"
        ),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("report.txt");
      expect(result.content).toBe("> ```md\n> ![Generated image](data:image/png;base64,%%%)\n> still code\n\nreport");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("does not treat a fenced line with trailing text as a closing fence", async () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");

    try {
      fs.writeFileSync(sourcePath, "report", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: [
          "```md",
          `![Generated image](${malformedTarget})`,
          "```notclose",
          "still code",
          "```",
          "",
          `[report](${sourcePath})`
        ].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("report.txt");
      expect(result.content).toBe("```md\n![Generated image](data:image/png;base64,%%%)\n```notclose\nstill code\n```\n\nreport");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves assistant data image markdown inside tilde fences", async () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");

    try {
      fs.writeFileSync(sourcePath, "report", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: [
          "~~~md",
          `![Generated image](${malformedTarget})`,
          "~~~",
          "",
          `[report](${sourcePath})`
        ].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("report.txt");
      expect(result.content).toBe("~~~md\n![Generated image](data:image/png;base64,%%%)\n~~~\n\nreport");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves assistant data image markdown inside indented code blocks", async () => {
    const conversation = createConversation();
    const malformedTarget = "data:image/png;base64,%%%";
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");

    try {
      fs.writeFileSync(sourcePath, "report", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: [
          `    ![Generated image](${malformedTarget})`,
          "    still code",
          "",
          `[report](${sourcePath})`
        ].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("report.txt");
      expect(result.content).toBe("    ![Generated image](data:image/png;base64,%%%)\n    still code\n\nreport");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves quoted code examples instead of importing their local links", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");
    const content = `>     [Report](${sourcePath})`;

    try {
      fs.writeFileSync(sourcePath, "report", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content,
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe(content);
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports a /tmp image markdown target and strips it from content", async () => {
    const conversation = createConversation();
    const tempDir = fs.mkdtempSync(path.join("/tmp", "eidon-assistant-image-"));
    const sourcePath = path.join(tempDir, "preview.png");

    try {
      fs.writeFileSync(sourcePath, "png-binary", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Preview:", "", `![preview](${sourcePath})`].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
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

  it("imports a workspace markdown link and keeps only its text in the content", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "workspace-log.txt");

    try {
      fs.writeFileSync(sourcePath, "hello from workspace", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached log:", "", `[log](${sourcePath})`].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("workspace-log.txt");
      expect(result.content).toBe("Attached log:\n\nlog");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports titled workspace markdown links and keeps only their text in the content", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "workspace-log.txt");
    const spacedPath = path.join(workspaceDir, "notes with space.txt");

    try {
      fs.writeFileSync(sourcePath, "hello from workspace", "utf8");
      fs.writeFileSync(spacedPath, "hello with title", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: [
          "Attached logs:",
          "",
          `[log](${sourcePath} "log title")`,
          `[notes](<${spacedPath}> "space title")`
        ].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [workspaceDir]
      });

      expect(result.attachments).toHaveLength(2);
      expect(result.content).toBe("Attached logs:\n\nlog\nnotes");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports reference-style workspace markdown links, keeping their text and dropping their definitions", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "workspace-log.txt");

    try {
      fs.writeFileSync(sourcePath, "hello from workspace", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached log:", "", "[log][workspace-log]", "", `[workspace-log]: ${sourcePath}`].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.filename).toBe("workspace-log.txt");
      expect(result.content).toBe("Attached log:\n\nlog");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("salvages reference-style assistant data images into managed attachments", async () => {
    const conversation = createConversation();
    const imageBytes = Buffer.from("generated-image-bytes", "utf8");
    const dataTarget = `data:image/png;base64,${imageBytes.toString("base64")}`;

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: ["Here is the generated image:", "", "![Generated image][generated]", "", `[generated]: ${dataTarget}`].join(
        "\n"
      ),
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.filename).toBe("generated.png");
    expect(result.attachments[0]?.kind).toBe("image");
    expect(result.attachments[0]?.mimeType).toBe("image/png");
    expect(readAttachmentBuffer(result.attachments[0]!)).toEqual(imageBytes);
    expect(result.content).toBe("Here is the generated image:");
    expect(result.failureNote).toBe("");
  });

  it("keeps shared reference definitions when only the image reference is salvaged", async () => {
    const conversation = createConversation();
    const imageBytes = Buffer.from("generated-image-bytes", "utf8");
    const dataTarget = `data:image/png;base64,${imageBytes.toString("base64")}`;

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: [
        "Keep the text reference:",
        "",
        "[Report][shared]",
        "![Generated image][shared]",
        "",
        `[shared]: ${dataTarget}`
      ].join("\n"),
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.filename).toBe("generated.png");
    expect(result.content).toBe(
      ["Keep the text reference:", "", "[Report][shared]", "", `[shared]: ${dataTarget}`].join("\n")
    );
    expect(result.failureNote).toBe("");
  });

  it("denies out-of-bounds local paths with a user-facing note", async () => {
    const conversation = createConversation();
    const outsideDir = fs.mkdtempSync(path.join(os.homedir(), ".eidon-out-of-bounds-"));
    const outsidePath = path.join(outsideDir, "secret.txt");

    try {
      fs.writeFileSync(outsidePath, "top secret", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: `[secret](${outsidePath})`,
        workspaceRoot: process.cwd()
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe("");
      expect(result.failureNote).toContain("outside the workspaces I can share files from");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("ignores external URLs", async () => {
    const conversation = createConversation();
    const content = "See [docs](https://example.com/spec.pdf)";

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content,
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.content).toBe(content);
    expect(result.failureNote).toBe("");
  });

  it("ignores escaped markdown openers", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");
    const content = [String.raw`\[Report](${sourcePath})`, String.raw`\![Generated image](data:image/png;base64,%%%)`].join(
      "\n"
    );

    try {
      fs.writeFileSync(sourcePath, "report", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content,
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe(content);
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("ignores relative paths", async () => {
    const conversation = createConversation();
    const content = "See [notes](./notes.txt)";

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content,
      workspaceRoot: process.cwd()
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.content).toBe(content);
    expect(result.failureNote).toBe("");
  });

  it("imports an angle-bracket local path with spaces", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "notes with space.txt");

    try {
      fs.writeFileSync(sourcePath, "spacey", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[notes](<${sourcePath}>)`].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:\n\nnotes");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports a local path containing parentheses", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "file(1).txt");

    try {
      fs.writeFileSync(sourcePath, "paren", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[file](${sourcePath})`].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:\n\nfile");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports a local path with an escaped closing parenthesis", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "file)name.txt");

    try {
      fs.writeFileSync(sourcePath, "escaped paren", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[file](${sourcePath.replace(")", "\\)")})`].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:\n\nfile");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves local markdown targets inside multi-backtick inline code spans", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "report.txt");
    const content = `Use \`\`[Report](${sourcePath})\`\` literally`;

    try {
      fs.writeFileSync(sourcePath, "keep literal", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content,
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe(content);
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("imports an angle-bracket local path with an escaped closing angle bracket", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "file>name.txt");

    try {
      fs.writeFileSync(sourcePath, "escaped angle", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["Attached:", "", `[file](<${sourcePath.replace(">", "\\>")}>)`].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]?.kind).toBe("text");
      expect(result.content).toBe("Attached:\n\nfile");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes after canonicalization", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const outsideDir = fs.mkdtempSync(path.join(os.homedir(), ".eidon-symlink-escape-"));
    const outsidePath = path.join(outsideDir, "private.txt");
    const symlinkPath = path.join(workspaceDir, "private-link.txt");

    try {
      fs.writeFileSync(outsidePath, "private", "utf8");
      fs.symlinkSync(outsidePath, symlinkPath);

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: `[private](${symlinkPath})`,
        workspaceRoot: process.cwd(),
        authorizedRoots: [workspaceDir]
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe("");
      expect(result.failureNote).toContain("outside the workspaces I can share files from");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("denies default app-data paths even when EIDON_DATA_DIR is unset", async () => {
    const conversation = createConversation();
    const previousDataDir = process.env.EIDON_DATA_DIR;
    const previousCwd = process.cwd();
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-default-data-"));
    const defaultAppDataDir = path.join(sandboxDir, ".data");
    const sourcePath = path.join(defaultAppDataDir, "assistant-private.txt");

    try {
      delete process.env.EIDON_DATA_DIR;
      process.chdir(sandboxDir);
      fs.mkdirSync(defaultAppDataDir, { recursive: true });
      fs.writeFileSync(sourcePath, "private app data", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: `[private](${sourcePath})`,
        workspaceRoot: sandboxDir,
        authorizedRoots: [sandboxDir]
      });

      expect(result.attachments).toHaveLength(0);
      expect(result.content).toBe("");
      expect(result.failureNote).toContain("outside the workspaces I can share files from");
    } finally {
      process.chdir(previousCwd);
      if (previousDataDir === undefined) {
        delete process.env.EIDON_DATA_DIR;
      } else {
        process.env.EIDON_DATA_DIR = previousDataDir;
      }
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  });

  it("deduplicates duplicate references to the same local file", async () => {
    const conversation = createConversation();
    const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-assistant-local-"));
    const sourcePath = path.join(workspaceDir, "duplicate.txt");

    try {
      fs.writeFileSync(sourcePath, "duplicate", "utf8");

      const result = await inferAssistantLocalAttachments({
        conversationId: conversation.id,
        content: ["First [copy](" + sourcePath + ")", "", "Second [copy](" + sourcePath + ")"].join("\n"),
        workspaceRoot: process.cwd(),
        authorizedRoots: [path.dirname(sourcePath)]
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.content).toBe("First copy\n\nSecond copy");
      expect(result.failureNote).toBe("");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});

describe("authorized roots inside the app data dir", () => {
  function createTeamRoot() {
    const teamRoot = path.join(process.env.EIDON_DATA_DIR!, "bot-workspaces", "user_files");
    const workspaceDir = path.join(teamRoot, "bot-files");
    fs.mkdirSync(workspaceDir, { recursive: true });
    return { teamRoot, workspaceDir };
  }

  it("attaches any file in a bot workspace and records where it came from", async () => {
    const conversation = createConversation();
    const { teamRoot, workspaceDir } = createTeamRoot();
    const sourcePath = path.join(workspaceDir, "reports", "q3 summary.csv");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "quarter,revenue\nq3,10", "utf8");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `Here it is: ${formatMarkdownFileLink("q3 summary.csv", sourcePath)}`,
      authorizedRoots: [teamRoot]
    });

    expect(result.failureNote).toBe("");
    expect(result.content).toBe("Here it is: q3 summary.csv");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.filename).toBe("q3_summary.csv");
    expect(result.attachments[0]?.kind).toBe("text");
    expect(result.attachments[0]?.sourcePath).toBe(fs.realpathSync(sourcePath));
    expect(readAttachmentBuffer(result.attachments[0]!).toString("utf8")).toBe("quarter,revenue\nq3,10");
  });

  it("keeps a delivered link's text wherever the link sits", async () => {
    const conversation = createConversation();
    const { teamRoot, workspaceDir } = createTeamRoot();
    const sourcePath = path.join(workspaceDir, "brief.md");
    fs.writeFileSync(sourcePath, "# Brief", "utf8");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `Here's the file: [the brief](${sourcePath}), ready for review.\n\n[brief.md](${sourcePath})\n- [brief](${sourcePath})`,
      authorizedRoots: [teamRoot]
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.content).toBe("Here's the file: the brief, ready for review.\n\nbrief.md\n- brief");
  });

  it("keeps a delivered link's text on its own line so a lead-in never points at nothing", async () => {
    const conversation = createConversation();
    const { teamRoot, workspaceDir } = createTeamRoot();
    const sourcePath = path.join(workspaceDir, "handoff.csv");
    fs.writeFileSync(sourcePath, "name,score", "utf8");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `Verified on disk.\n\n**Here's the file:**\n\n[handoff.csv](${sourcePath})\n\n**Spec compliance:** all good.`,
      authorizedRoots: [teamRoot]
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.content).toBe("Verified on disk.\n\n**Here's the file:**\n\nhandoff.csv\n\n**Spec compliance:** all good.");
  });

  it("keeps only the file name when a delivered link's text is its own path", async () => {
    const conversation = createConversation();
    const { teamRoot, workspaceDir } = createTeamRoot();
    const sourcePath = path.join(workspaceDir, "q4.csv");
    fs.writeFileSync(sourcePath, "q,rev", "utf8");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `**Path:** [\`${sourcePath}\`](${sourcePath})`,
      authorizedRoots: [teamRoot]
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.content).toBe("**Path:** q4.csv");
    expect(result.content).not.toContain(workspaceDir);
  });

  it("still denies app data outside the authorized bot workspaces", async () => {
    const conversation = createConversation();
    const { teamRoot } = createTeamRoot();
    const secretPath = path.join(process.env.EIDON_DATA_DIR!, "secret.txt");
    fs.writeFileSync(secretPath, "private app data", "utf8");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `[secret](${secretPath})`,
      authorizedRoots: [teamRoot]
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.failureNote).toContain("outside the workspaces I can share files from");
  });

  it("denies a workspace symlink that resolves to other app data", async () => {
    const conversation = createConversation();
    const { teamRoot, workspaceDir } = createTeamRoot();
    const secretPath = path.join(process.env.EIDON_DATA_DIR!, "eidon-secret.db");
    const linkPath = path.join(workspaceDir, "copy.db");
    fs.writeFileSync(secretPath, "database", "utf8");
    fs.symlinkSync(secretPath, linkPath);

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `[db](${linkPath})`,
      authorizedRoots: [teamRoot]
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.failureNote).toContain("copy.db");
  });

  it("does not treat the app data dir itself as an authorized root", async () => {
    const conversation = createConversation();
    createTeamRoot();
    const secretPath = path.join(process.env.EIDON_DATA_DIR!, "secret.txt");
    fs.writeFileSync(secretPath, "private app data", "utf8");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `[secret](${secretPath})`,
      authorizedRoots: [process.env.EIDON_DATA_DIR!]
    });

    expect(result.attachments).toHaveLength(0);
  });

  it("delivers same-named files from different folders instead of treating them as duplicates", async () => {
    const conversation = createConversation();
    const { teamRoot, workspaceDir } = createTeamRoot();
    const first = path.join(workspaceDir, "north", "summary.md");
    const second = path.join(workspaceDir, "south", "summary.md");
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.writeFileSync(first, "north", "utf8");
    fs.writeFileSync(second, "south", "utf8");

    const firstPass = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `[north](${first})`,
      authorizedRoots: [teamRoot]
    });
    const secondPass = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `[north again](${first}) [south](${second})`,
      authorizedRoots: [teamRoot],
      existingAttachments: firstPass.attachments
    });

    expect(firstPass.attachments).toHaveLength(1);
    expect(secondPass.attachments.map((attachment) => attachment.sourcePath)).toEqual([fs.realpathSync(second)]);
    expect(secondPass.failureNote).toBe("");
  });

  it("ignores authorized roots that do not exist", async () => {
    const conversation = createConversation();
    const { workspaceDir } = createTeamRoot();
    const sourcePath = path.join(workspaceDir, "notes.txt");
    fs.writeFileSync(sourcePath, "notes", "utf8");

    const result = await inferAssistantLocalAttachments({
      conversationId: conversation.id,
      content: `[notes](${sourcePath})`,
      authorizedRoots: [path.join(workspaceDir, "missing")]
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.failureNote).toContain("notes.txt");
  });
});

describe("delivered file links", () => {
  function attachment(overrides: Partial<MessageAttachment>): MessageAttachment {
    return {
      id: "att_1",
      conversationId: "conv_1",
      messageId: "msg_1",
      filename: "report.csv",
      mimeType: "text/csv",
      byteSize: 10,
      sha256: "hash",
      relativePath: "conv_1/att_1_report.csv",
      kind: "text",
      extractedText: "",
      createdAt: "2026-09-25T00:00:00.000Z",
      ...overrides
    };
  }

  it("formats plain and spaced paths as markdown links the importer accepts", () => {
    expect(formatMarkdownFileLink("report.csv", "/work/report.csv")).toBe("[report.csv](/work/report.csv)");
    expect(formatMarkdownFileLink("a [b].txt", "/work dir/a (b).txt")).toBe("[a \\[b\\].txt](</work dir/a (b).txt>)");
    expect(formatMarkdownFileLink("odd.txt", "/work/<odd>.txt")).toBe("[odd.txt](</work/%3Codd%3E.txt>)");
  });

  it("appends links for attachments that came from a workspace", () => {
    const content = appendDeliveredFileLinks("Done.", [
      attachment({ sourcePath: "/work/reports/q3.csv" }),
      attachment({ id: "att_2", filename: "shot.png", kind: "image", sourcePath: null })
    ]);

    expect(content).toBe("Done.\n\n[q3.csv](/work/reports/q3.csv)");
  });

  it("returns the content unchanged when no attachment has a source path", () => {
    expect(appendDeliveredFileLinks("Done.", [attachment({})])).toBe("Done.");
    expect(appendDeliveredFileLinks("Done.")).toBe("Done.");
  });

  it("lists files for replies that have no text", () => {
    expect(
      appendDeliveredFileLinks("  ", [
        attachment({ sourcePath: "/work/q3.csv" }),
        attachment({ id: "att_2", sourcePath: "/work/q4.csv" })
      ])
    ).toBe("[q3.csv](/work/q3.csv)\n[q4.csv](/work/q4.csv)");
  });
});
