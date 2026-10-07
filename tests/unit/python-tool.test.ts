import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { executeLocalShellCommand, resolveShellWorkspaceDir, resolveToolOutputDir } from "@/lib/local-shell";
import { approveToolApproval, createToolApprovalRules } from "@/lib/tool-approvals";
import { executePythonCode, executeToolCall, type RuntimeAction } from "@/lib/tool-executors";
import type { Bot, PromptMessage, ToolApprovalProposalPayload } from "@/lib/types";
import { createLocalUser } from "@/lib/users";
import { createVaultEntry } from "@/lib/vault";

const botsMock = vi.hoisted(() => ({
  getBotByConversationId: vi.fn<(conversationId: string) => Bot | null>()
}));

vi.mock("@/lib/bots", () => ({
  getBotByConversationId: botsMock.getBotByConversationId
}));

vi.mock("@/lib/local-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-shell")>();
  return { ...actual, executeLocalShellCommand: vi.fn(actual.executeLocalShellCommand) };
});

const hasPython = spawnSync("python3", ["--version"]).status === 0;
const SUM_CODE = "values = [1, 2, 3]\nprint(sum(values))";

function shellResult(stdout: string, exitCode = 0) {
  return { stdout, stderr: "", exitCode, timedOut: false, isError: exitCode !== 0, captureTruncated: false };
}

async function createFixture(username: string) {
  const user = await createLocalUser({ username, password: "Password123!", role: "user" });
  const conversation = createConversation("Chat", null, {}, user.id);
  const message = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "streaming",
    estimatedTokens: 0
  });
  const fixture = {
    user,
    conversation,
    onApproval: undefined as ((actionId: string) => void) | undefined,
    onActionStart: vi.fn(async (action: RuntimeAction) => {
      const persisted = createMessageAction({ messageId: message.id, ...action });
      if (persisted.kind === "tool_approval") fixture.onApproval?.(persisted.id);
      return persisted.id;
    }),
    onActionComplete: vi.fn(),
    onActionError: vi.fn(),
    context(unattended = true) {
      return {
        input: {
          conversationId: conversation.id,
          toolApproval: { userId: user.id, unattended },
          onActionStart: fixture.onActionStart,
          onActionComplete: fixture.onActionComplete,
          onActionError: fixture.onActionError
        },
        timelineSortOrder: 0,
        promptMessages: [] as PromptMessage[]
      };
    },
    startedActions() {
      return fixture.onActionStart.mock.calls.map(([action]) => action);
    }
  };
  return fixture;
}

function lastContent(result: { promptMessages: PromptMessage[] }) {
  return String(result.promptMessages.at(-1)?.content);
}

describe("run_python executor", () => {
  beforeEach(() => {
    botsMock.getBotByConversationId.mockReturnValue(null);
    vi.mocked(executeLocalShellCommand).mockClear();
  });

  it("pipes the code to python3 in the conversation workspace and reports without echoing it", async () => {
    const fixture = await createFixture("python-stdin");
    createToolApprovalRules(fixture.user.id, "shell", ["python3"]);
    vi.mocked(executeLocalShellCommand).mockResolvedValueOnce(shellResult("6"));

    const context = fixture.context();
    const result = await executeToolCall(
      { id: "tc_py", name: "run_python", arguments: JSON.stringify({ code: SUM_CODE }) },
      {
        ...context,
        input: { ...context.input, skills: [], mcpToolSets: [] },
        mcpServers: [],
        loadedSkillIds: new Set(),
        successfulReadOnlyToolResults: new Map()
      }
    );

    expect(executeLocalShellCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "python3 -u -",
        stdin: SUM_CODE,
        cwd: resolveShellWorkspaceDir(fixture.conversation.id)
      })
    );
    expect(lastContent(result)).toBe("Python result\nStatus: success\nResult:\n6");
    expect(fixture.startedActions()).toEqual([
      {
        kind: "shell_command",
        label: "Python",
        detail: "values = [1, 2, 3] print(sum(values))",
        toolName: "run_python",
        arguments: { code: SUM_CODE, timeoutMs: undefined }
      }
    ]);
    expect(fixture.onActionComplete).toHaveBeenCalledWith(expect.any(String), {
      detail: "values = [1, 2, 3] print(sum(values))",
      resultSummary: "6"
    });
  });

  it("runs packages through uv with each requirement quoted", async () => {
    const fixture = await createFixture("python-packages");
    createToolApprovalRules(fixture.user.id, "shell", ["python3"]);
    vi.mocked(executeLocalShellCommand).mockResolvedValueOnce(shellResult("ok"));

    await executePythonCode(
      "tc_py_packages",
      { code: "import pandas", packages: ["pandas", "numpy>=2,<3", "requests[socks]"], timeout_ms: 90_000 },
      fixture.context()
    );

    expect(executeLocalShellCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "uv run --quiet --no-project --with 'pandas' --with 'numpy>=2,<3' --with 'requests[socks]' python3 -u -",
        stdin: "import pandas",
        timeoutMs: 90_000
      })
    );
    expect(fixture.startedActions()[0].arguments).toEqual({
      code: "import pandas",
      packages: ["pandas", "numpy>=2,<3", "requests[socks]"],
      timeoutMs: 90_000
    });
  });

  it("rejects empty code and unsafe package lists before asking for approval", async () => {
    const fixture = await createFixture("python-invalid");
    const packageError =
      'Error: packages must be a list of at most 10 PyPI requirements such as "pandas" or "numpy>=2".';
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ code: "   " }, "Error: Python code is required."],
      [{}, "Error: Python code is required."],
      [{ code: "print(1)", packages: ["--index-url=https://evil.example"] }, packageError],
      [{ code: "print(1)", packages: ["pandas; rm -rf /"] }, packageError],
      [{ code: "print(1)", packages: ["pandas'"] }, packageError],
      [{ code: "print(1)", packages: "pandas" }, packageError],
      [{ code: "print(1)", packages: [1] }, packageError],
      [{ code: "print(1)", packages: Array.from({ length: 11 }, (_, index) => `pkg${index}`) }, packageError],
      [{ code: "print(1)", secrets: "GH_TOKEN" }, "Error: secrets must be a list of { name, variable } objects."]
    ];

    for (const [args, expected] of cases) {
      const result = await executePythonCode("tc_py_invalid", args, fixture.context(false));
      expect(lastContent(result)).toBe(expected);
      expect(result.nextSortOrder).toBe(0);
    }
    expect(executeLocalShellCommand).not.toHaveBeenCalled();
    expect(fixture.onActionStart).not.toHaveBeenCalled();
  });

  it("shows the Python source for approval and remembers an always-allow as the python3 command family", async () => {
    const fixture = await createFixture("python-approval");
    fixture.onApproval = (actionId) => approveToolApproval(actionId, { allowAlways: true }, fixture.user.id);
    vi.mocked(executeLocalShellCommand).mockResolvedValue(shellResult("ok"));

    await executePythonCode("tc_py_approve", { code: SUM_CODE, packages: ["pandas"] }, fixture.context(false));
    const approval = fixture.startedActions().find((action) => action.kind === "tool_approval");

    expect(approval?.label).toBe('Allow "python3" commands?');
    expect(approval?.proposalPayload as ToolApprovalProposalPayload).toEqual({
      operation: "tool_approval",
      scope: "shell",
      families: ["python3"],
      classified: true,
      command: `# packages: pandas\n${SUM_CODE}`
    });

    fixture.onActionStart.mockClear();
    await executePythonCode("tc_py_again", { code: "print(1)" }, fixture.context(true));
    expect(fixture.startedActions().map((action) => action.kind)).toEqual(["shell_command"]);
    vi.mocked(executeLocalShellCommand).mockReset();
  });

  it("denies unattended runs that no python3 rule covers", async () => {
    const fixture = await createFixture("python-denied");
    createToolApprovalRules(fixture.user.id, "shell", ["echo"]);

    const result = await executePythonCode("tc_py_denied", { code: "print(1)" }, fixture.context(true));

    expect(executeLocalShellCommand).not.toHaveBeenCalled();
    expect(lastContent(result)).toContain("Denied");
    expect(fixture.startedActions()).toEqual([
      expect.objectContaining({ kind: "shell_command", toolName: "run_python", label: "Python" })
    ]);
    expect(fixture.onActionError).toHaveBeenCalledTimes(1);
  });

  it("lets a bot read its own conversation's attachments and saved output, but nothing else in the data dir", async () => {
    const fixture = await createFixture("python-bot");
    const bot = { id: "bot_python_probe", userId: fixture.user.id } as Bot;
    botsMock.getBotByConversationId.mockReturnValue(bot);
    createToolApprovalRules(fixture.user.id, "shell", ["python3"]);
    const attachmentDir = join(resolve(process.env.EIDON_DATA_DIR ?? "./.test-data"), "attachments", fixture.conversation.id);
    mkdirSync(attachmentDir, { recursive: true });
    const outputDir = resolveToolOutputDir(fixture.conversation.id, true);
    vi.mocked(executeLocalShellCommand).mockResolvedValueOnce(shellResult("ok"));
    const { stopEgressProxy } = await import("@/lib/egress-proxy");

    try {
      await executePythonCode("tc_py_bot", { code: "print(1)" }, fixture.context());
    } finally {
      await stopEgressProxy();
    }

    const call = vi.mocked(executeLocalShellCommand).mock.calls[0][0];
    const { getBotWorkspaceDir } = await import("@/lib/bot-sandbox");
    expect(call.cwd).toBe(getBotWorkspaceDir(bot));
    expect(call.isolation?.readOnly).toEqual([attachmentDir, outputDir]);
    expect(call.isolation?.readWrite).not.toContain(attachmentDir);
  });

  it("saves long output to a file and returns its path with the start and end", async () => {
    const fixture = await createFixture("python-long-output");
    createToolApprovalRules(fixture.user.id, "shell", ["python3"]);
    const longOutput = `${"head-".repeat(2_000)}${"tail-".repeat(2_000)}END`;
    vi.mocked(executeLocalShellCommand).mockResolvedValueOnce(shellResult(longOutput));

    const result = await executePythonCode("tc_py_long", { code: "print('x' * 20000)" }, fixture.context());
    const content = lastContent(result);
    const savedPath = /saved to (\S+\.txt)\./.exec(content)?.[1] ?? "";

    expect(content).toContain("[Output was 20,003 characters; the full output is saved to");
    expect(content.endsWith("END")).toBe(true);
    expect(content.length).toBeLessThan(8_100);
    expect(existsSync(savedPath)).toBe(true);
    expect(readFileSync(savedPath, "utf8")).toBe(longOutput);
  });

  it.skipIf(!hasPython)("computes with a real python3 and hides vault secrets from its output", async () => {
    const fixture = await createFixture("python-real");
    createToolApprovalRules(fixture.user.id, "shell", ["python3"]);
    createVaultEntry(fixture.user.id, { name: "API token", secret: "tok_python_secret" });

    const result = await executePythonCode(
      "tc_py_real",
      {
        code: 'import json, os\nprint(json.dumps({"sum": sum(range(10))}))\nprint(os.environ["API_TOKEN"])',
        secrets: [{ name: "API token", variable: "API_TOKEN" }]
      },
      fixture.context()
    );
    const content = lastContent(result);

    expect(content).toContain('{"sum": 45}');
    expect(content).toContain("[hidden secret]");
    expect(content).not.toContain("tok_python_secret");
  });

  it.skipIf(!hasPython)("returns the traceback when the script fails", async () => {
    const fixture = await createFixture("python-traceback");
    createToolApprovalRules(fixture.user.id, "shell", ["python3"]);

    const result = await executePythonCode("tc_py_error", { code: "print('before')\n1 / 0" }, fixture.context());
    const content = lastContent(result);

    expect(content).toContain("Status: error");
    expect(content).toContain("before");
    expect(content).toContain("ZeroDivisionError");
    expect(fixture.onActionError).toHaveBeenCalledTimes(1);
  });
});
