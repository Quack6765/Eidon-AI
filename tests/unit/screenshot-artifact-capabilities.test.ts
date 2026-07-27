import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

import { readAttachmentBuffer } from "@/lib/attachments";
import { attachAssistantFilesFromCompletedAction } from "@/lib/content-persistence";
import {
  createConversation,
  createMessage,
  createMessageAction,
  getMessage,
  updateMessageAction
} from "@/lib/conversations";
import { executeShellCommand, type RuntimeAction } from "@/lib/tool-executors";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);

function createExecutionContext() {
  const conversation = createConversation("Screenshot capability");
  const assistantMessage = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    status: "streaming"
  });

  return {
    conversation,
    assistantMessage,
    context: {
      input: {
        onActionStart(action: RuntimeAction) {
          return createMessageAction({
            ...action,
            messageId: assistantMessage.id,
            sortOrder: 0
          }).id;
        },
        async onActionComplete(
          handle: string | undefined,
          patch: { detail?: string; resultSummary?: string }
        ) {
          if (!handle) return;
          const action = updateMessageAction(handle, {
            status: "completed",
            detail: patch.detail,
            resultSummary: patch.resultSummary,
            completedAt: new Date().toISOString()
          });
          if (action) {
            await attachAssistantFilesFromCompletedAction(
              conversation.id,
              assistantMessage.id,
              action
            );
          }
        },
        onActionError: vi.fn()
      },
      timelineSortOrder: 0,
      promptMessages: []
    }
  };
}

describe("screenshot artifact capabilities", () => {
  beforeEach(() => {
    shellMocks.executeLocalShellCommand.mockReset();
    shellMocks.summarizeShellResult.mockReset();
    shellMocks.summarizeShellResult.mockReturnValue("screenshot result");
  });

  it("attaches one verified image from a successful standalone screenshot execution", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-screenshot-capability-"));
    const screenshotPath = path.join(tempDir, "capture.png");
    shellMocks.executeLocalShellCommand.mockImplementation(async () => {
      fs.writeFileSync(screenshotPath, PNG_BYTES);
      return {
        stdout: `Screenshot saved to ${screenshotPath}`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        isError: false
      };
    });
    const { conversation, assistantMessage, context } = createExecutionContext();

    try {
      await executeShellCommand(
        "tool-1",
        { command: `agent-browser screenshot ${screenshotPath} --full` },
        context
      );

      const persistedMessage = getMessage(assistantMessage.id);
      expect(persistedMessage?.attachments).toHaveLength(1);
      expect(persistedMessage?.attachments?.[0]).toEqual(expect.objectContaining({
        filename: "capture.png",
        mimeType: "image/png",
        kind: "image"
      }));
      expect(readAttachmentBuffer(persistedMessage!.attachments![0]!)).toEqual(PNG_BYTES);

      await attachAssistantFilesFromCompletedAction(
        conversation.id,
        assistantMessage.id,
        persistedMessage!.actions![0]!
      );
      expect(getMessage(assistantMessage.id)?.attachments).toHaveLength(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "compound command",
      prepare(pathname: string) {
        return `agent-browser screenshot ${pathname} --full && true`;
      },
      before: undefined
    },
    {
      name: "lookalike browser executable",
      prepare(pathname: string) {
        return `/tmp/agent-browser screenshot ${pathname} --full`;
      },
      before: undefined
    },
    {
      name: "shell expansion in a flag",
      prepare(pathname: string) {
        return `agent-browser screenshot ${pathname} --full=$(true)`;
      },
      before: undefined
    },
    {
      name: "pre-existing path",
      prepare(pathname: string) {
        return `agent-browser screenshot ${pathname} --full`;
      },
      before(pathname: string) {
        fs.writeFileSync(pathname, PNG_BYTES);
      }
    }
  ])("does not attach output from a $name", async ({ prepare, before }) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-untrusted-screenshot-"));
    const screenshotPath = path.join(tempDir, "capture.png");
    before?.(screenshotPath);
    shellMocks.executeLocalShellCommand.mockImplementation(async () => {
      fs.writeFileSync(screenshotPath, PNG_BYTES);
      return {
        stdout: "done",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        isError: false
      };
    });
    const { assistantMessage, context } = createExecutionContext();

    try {
      await executeShellCommand("tool-1", { command: prepare(screenshotPath) }, context);
      expect(getMessage(assistantMessage.id)?.attachments).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not attach a file from a failed screenshot execution or mismatched image bytes", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-failed-screenshot-"));
    const failedPath = path.join(tempDir, "failed.png");
    const invalidPath = path.join(tempDir, "invalid.png");
    const first = createExecutionContext();
    const second = createExecutionContext();

    try {
      shellMocks.executeLocalShellCommand.mockImplementationOnce(async () => {
        fs.writeFileSync(failedPath, PNG_BYTES);
        return {
          stdout: "",
          stderr: "failed",
          exitCode: 1,
          timedOut: false,
          isError: true
        };
      });
      await executeShellCommand(
        "tool-1",
        { command: `agent-browser screenshot ${failedPath}` },
        first.context
      );

      shellMocks.executeLocalShellCommand.mockImplementationOnce(async () => {
        fs.writeFileSync(invalidPath, "not a png", "utf8");
        return {
          stdout: "done",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          isError: false
        };
      });
      await executeShellCommand(
        "tool-2",
        { command: `agent-browser screenshot ${invalidPath}` },
        second.context
      );

      expect(getMessage(first.assistantMessage.id)?.attachments).toEqual([]);
      expect(getMessage(second.assistantMessage.id)?.attachments).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
