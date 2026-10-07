import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const shellMocks = vi.hoisted(() => ({
  executeLocalShellCommand: vi.fn(),
  summarizeShellResult: vi.fn().mockReturnValue("screenshot result")
}));

vi.mock("@/lib/local-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-shell")>();
  return {
    ...actual,
    executeLocalShellCommand: shellMocks.executeLocalShellCommand,
    summarizeShellResult: shellMocks.summarizeShellResult
  };
});

import {
  listAttachmentsForConversation,
  readAttachmentBuffer,
  resolveAttachmentPath
} from "@/lib/attachments";
import {
  createConversation,
  createMessage,
  createMessageAction,
  getMessage,
  updateMessageAction
} from "@/lib/conversations";
import { executeShellCommand, type RuntimeAction } from "@/lib/tool-executors";
import { createToolApprovalRules } from "@/lib/tool-approvals";
import type { PromptMessage } from "@/lib/types";

const HEADER_ONLY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);

function createPng(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#3366ff" } }).png().toBuffer();
}

function createExecutionContext(options: { assistantMessageId?: string | null } = {}) {
  const conversation = createConversation("Browser screenshots");
  const assistantMessage = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    status: "streaming"
  });
  const onActionComplete = vi.fn((handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => {
    if (!handle) return;
    updateMessageAction(handle, {
      status: "completed",
      detail: patch.detail,
      resultSummary: patch.resultSummary,
      completedAt: new Date().toISOString()
    });
  });
  const onActionError = vi.fn();

  return {
    conversation,
    assistantMessage,
    onActionComplete,
    onActionError,
    context: {
      input: {
        conversationId: conversation.id,
        assistantMessageId: options.assistantMessageId === null
          ? undefined
          : options.assistantMessageId ?? assistantMessage.id,
        onActionStart(action: RuntimeAction) {
          return createMessageAction({
            ...action,
            messageId: assistantMessage.id,
            sortOrder: 0
          }).id;
        },
        onActionComplete,
        onActionError
      },
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    }
  };
}

function writeOnRun(pathname: string, bytes: Buffer | string, result: { exitCode?: number; isError?: boolean } = {}) {
  shellMocks.executeLocalShellCommand.mockImplementationOnce(async () => {
    fs.writeFileSync(pathname, bytes);
    return {
      stdout: result.isError ? "" : `Screenshot saved to ${pathname}`,
      stderr: result.isError ? "failed" : "",
      exitCode: result.exitCode ?? 0,
      timedOut: false,
      isError: result.isError ?? false
    };
  });
}

function toolResultOf(result: { promptMessages: PromptMessage[] }) {
  const message = result.promptMessages.at(-1)!;
  expect(message.role).toBe("tool");
  return message.content;
}

describe("browser screenshots", () => {
  let tempDir: string;

  beforeEach(() => {
    createToolApprovalRules(null, "shell", ["agent-browser", "true"]);
    shellMocks.executeLocalShellCommand.mockReset();
    shellMocks.summarizeShellResult.mockReset();
    shellMocks.summarizeShellResult.mockReturnValue("screenshot result");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-browser-screenshot-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("attaches a successful standalone screenshot and returns it to the model", async () => {
    const screenshotPath = path.join(tempDir, "capture.png");
    const pngBytes = await createPng(32, 24);
    writeOnRun(screenshotPath, pngBytes);
    const { assistantMessage, context, onActionComplete } = createExecutionContext();

    const result = await executeShellCommand(
      "tool-1",
      { command: `agent-browser screenshot ${screenshotPath} --full` },
      context
    );

    const attachments = getMessage(assistantMessage.id)?.attachments ?? [];
    expect(attachments).toHaveLength(1);
    const [attachment] = attachments;
    expect(attachment).toEqual(expect.objectContaining({
      filename: "capture.png",
      mimeType: "image/png",
      kind: "image",
      sourcePath: null
    }));
    expect(readAttachmentBuffer(attachment!)).toEqual(pngBytes);

    const note = `Screenshot attached as capture.png (stored at ${resolveAttachmentPath(attachment!)}).`;
    expect(toolResultOf(result)).toEqual([
      { type: "text", text: expect.stringContaining(note) },
      {
        type: "image",
        attachmentId: attachment!.id,
        filename: "capture.png",
        mimeType: "image/png",
        relativePath: attachment!.relativePath
      }
    ]);
    expect(onActionComplete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      resultSummary: `screenshot result\n\n${note}`
    }));
    expect(getMessage(assistantMessage.id)?.actions?.[0]?.resultSummary).toBe(`screenshot result\n\n${note}`);
  });

  it.each([
    { name: "compound command", command: (pathname: string) => `agent-browser screenshot ${pathname} --full && true` },
    { name: "lookalike browser executable", command: (pathname: string) => `/tmp/agent-browser screenshot ${pathname}` },
    { name: "shell expansion in a flag", command: (pathname: string) => `agent-browser screenshot ${pathname} --full=$(true)` },
    { name: "relative path", command: () => "agent-browser screenshot capture.png" }
  ])("does not attach output from a $name", async ({ command }) => {
    const screenshotPath = path.join(tempDir, "capture.png");
    writeOnRun(screenshotPath, await createPng(8, 8));
    const { assistantMessage, context } = createExecutionContext();

    const result = await executeShellCommand("tool-1", { command: command(screenshotPath) }, context);

    expect(getMessage(assistantMessage.id)?.attachments).toEqual([]);
    expect(toolResultOf(result)).toEqual(expect.not.stringContaining("Screenshot"));
  });

  it("tells the model to use a new path when the screenshot path already existed", async () => {
    const screenshotPath = path.join(tempDir, "capture.png");
    const pngBytes = await createPng(8, 8);
    fs.writeFileSync(screenshotPath, pngBytes);
    writeOnRun(screenshotPath, pngBytes);
    const { assistantMessage, context } = createExecutionContext();

    const result = await executeShellCommand(
      "tool-1",
      { command: `agent-browser screenshot ${screenshotPath}` },
      context
    );

    expect(getMessage(assistantMessage.id)?.attachments).toEqual([]);
    expect(toolResultOf(result)).toContain(
      `Screenshot not shown: ${screenshotPath} existed before the command. Save each screenshot to a new path.`
    );
  });

  it("does not attach a file from a failed screenshot execution or mismatched image bytes", async () => {
    const failedPath = path.join(tempDir, "failed.png");
    const invalidPath = path.join(tempDir, "invalid.png");
    const first = createExecutionContext();
    const second = createExecutionContext();

    writeOnRun(failedPath, await createPng(8, 8), { exitCode: 1, isError: true });
    await executeShellCommand("tool-1", { command: `agent-browser screenshot ${failedPath}` }, first.context);

    writeOnRun(invalidPath, "not a png");
    const invalid = await executeShellCommand(
      "tool-2",
      { command: `agent-browser screenshot ${invalidPath}` },
      second.context
    );

    expect(getMessage(first.assistantMessage.id)?.attachments).toEqual([]);
    expect(getMessage(second.assistantMessage.id)?.attachments).toEqual([]);
    expect(typeof toolResultOf(invalid)).toBe("string");
  });

  it.each([
    {
      name: "is taller than the inline limit",
      bytes: () => createPng(16, 8001),
      reason: "The screenshot is 16x8001 px (0.0 MB), too large to show to you."
    },
    {
      name: "cannot be decoded",
      bytes: async () => HEADER_ONLY_PNG,
      reason: "The screenshot could not be decoded, so it is not shown to you."
    }
  ])("attaches a screenshot that $name without sending it to the model", async ({ bytes, reason }) => {
    const screenshotPath = path.join(tempDir, "capture.png");
    writeOnRun(screenshotPath, await bytes());
    const { assistantMessage, context } = createExecutionContext();

    const result = await executeShellCommand(
      "tool-1",
      { command: `agent-browser screenshot ${screenshotPath}` },
      context
    );

    expect(getMessage(assistantMessage.id)?.attachments).toHaveLength(1);
    const content = toolResultOf(result);
    expect(typeof content).toBe("string");
    expect(content).toContain("Screenshot attached as capture.png");
    expect(content).toContain(reason);
  });

  it("returns text only when there is no assistant message to attach to", async () => {
    const screenshotPath = path.join(tempDir, "capture.png");
    writeOnRun(screenshotPath, await createPng(8, 8));
    const { conversation, context } = createExecutionContext({ assistantMessageId: null });

    const result = await executeShellCommand(
      "tool-1",
      { command: `agent-browser screenshot ${screenshotPath}` },
      context
    );

    expect(listAttachmentsForConversation(conversation.id)).toEqual([]);
    expect(toolResultOf(result)).toEqual(expect.not.stringContaining("Screenshot"));
  });

  it("removes the stored copy and keeps the command successful when binding fails", async () => {
    const screenshotPath = path.join(tempDir, "capture.png");
    writeOnRun(screenshotPath, await createPng(8, 8));
    const { conversation, context, onActionComplete, onActionError } = createExecutionContext({
      assistantMessageId: "msg_missing"
    });

    const result = await executeShellCommand(
      "tool-1",
      { command: `agent-browser screenshot ${screenshotPath}` },
      context
    );

    expect(listAttachmentsForConversation(conversation.id)).toEqual([]);
    expect(onActionError).not.toHaveBeenCalled();
    expect(onActionComplete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      resultSummary: "screenshot result\n\nThe screenshot could not be attached."
    }));
    expect(toolResultOf(result)).toContain("Status: success");
  });
});
