import { realpathSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { executeLocalShellCommand } from "@/lib/local-shell";
import { redactSecrets } from "@/lib/secret-redaction";
import { describeToolApprovalSecrets } from "@/lib/tool-approval-display";
import { approveToolApproval, createToolApprovalRules } from "@/lib/tool-approvals";
import { executeShellCommand, type RuntimeAction } from "@/lib/tool-executors";
import type { Bot, PromptMessage, ToolApprovalProposalPayload } from "@/lib/types";
import { createLocalUser } from "@/lib/users";
import { createVaultEntry, deleteVaultEntry, getVaultEntry } from "@/lib/vault";

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

async function createApprovalUser() {
  return createLocalUser({
    username: "exec-probe",
    password: "Password123!",
    role: "user"
  });
}

function buildContext(conversationId: string, userId: string) {
  return {
    input: {
      conversationId,
      toolApproval: { userId, unattended: true }
    },
    timelineSortOrder: 0,
    promptMessages: [] as PromptMessage[]
  };
}

describe("shell command executor sandboxing", () => {
  it("runs non-bot commands in the conversation workspace, not the app root", async () => {
    const user = await createApprovalUser();
    botsMock.getBotByConversationId.mockReturnValue(null);
    const { executeShellCommand } = await import("@/lib/tool-executors");
    const { resolveShellWorkspaceDir } = await import("@/lib/local-shell");
    const { createToolApprovalRules } = await import("@/lib/tool-approvals");

    createToolApprovalRules(user.id, "shell", ["pwd"]);

    const result = await executeShellCommand(
      "tc_workspace",
      { command: "pwd" },
      buildContext("conv_exec_probe", user.id)
    );
    const content = String(result.promptMessages.at(-1)?.content);
    const resultLine = content.trimEnd().split("\n").at(-1);

    expect(resultLine).toBe(realpathSync(resolveShellWorkspaceDir("conv_exec_probe")));
    expect(resultLine).not.toBe(process.cwd());
  });

  it("gives regular chats their owner's browser session instead of a server-wide one", async () => {
    const user = await createApprovalUser();
    botsMock.getBotByConversationId.mockReturnValue(null);
    const { executeShellCommand } = await import("@/lib/tool-executors");
    const { createConversation } = await import("@/lib/conversations");
    const { createToolApprovalRules } = await import("@/lib/tool-approvals");
    const conversation = createConversation("Chat", null, {}, user.id);

    createToolApprovalRules(user.id, "shell", ["echo"]);

    const result = await executeShellCommand(
      "tc_user_session",
      { command: 'echo "session=$AGENT_BROWSER_SESSION dir=$AGENT_BROWSER_SOCKET_DIR"' },
      buildContext(conversation.id, user.id)
    );
    const content = String(result.promptMessages.at(-1)?.content);

    const { userBrowserTarget } = await import("@/lib/agent-computer");
    expect(content).toContain("session=tab");
    expect(content).toContain(`dir=${userBrowserTarget(user.id).socketDir}`);
  });

  it("keeps bot commands in the per-bot workspace with the browser sandbox env", async () => {
    const user = await createApprovalUser();
    const bot = { id: "bot_exec_probe", userId: user.id } as Bot;
    botsMock.getBotByConversationId.mockReturnValue(bot);
    const { executeShellCommand } = await import("@/lib/tool-executors");
    const { getBotWorkspaceDir } = await import("@/lib/bot-sandbox");
    const { createToolApprovalRules } = await import("@/lib/tool-approvals");

    createToolApprovalRules(user.id, "shell", ["pwd", "echo"]);

    const result = await executeShellCommand(
      "tc_bot",
      { command: 'pwd; echo "session=$AGENT_BROWSER_SESSION"; echo "secret=[$EIDON_SESSION_SECRET]"' },
      buildContext("conv_bot_probe", user.id)
    );
    const content = String(result.promptMessages.at(-1)?.content);

    expect(content).toContain(realpathSync(getBotWorkspaceDir(bot)));
    expect(content).toContain("session=tab");
    expect(content).toContain("secret=[]");
  });

  it("gives bot commands their own home and routes their web traffic through Eidon's filter", async () => {
    const user = await createApprovalUser();
    const bot = { id: "bot_exec_home", userId: user.id } as Bot;
    botsMock.getBotByConversationId.mockReturnValue(bot);
    const { executeShellCommand } = await import("@/lib/tool-executors");
    const { getBotHomeDir } = await import("@/lib/bot-sandbox");
    const { createToolApprovalRules } = await import("@/lib/tool-approvals");
    const { stopEgressProxy } = await import("@/lib/egress-proxy");

    createToolApprovalRules(user.id, "shell", ["echo"]);

    try {
      const result = await executeShellCommand(
        "tc_bot_home",
        { command: 'echo "home=$HOME proxy=$HTTPS_PROXY node=$NODE_USE_ENV_PROXY"' },
        buildContext("conv_bot_home", user.id)
      );
      const content = String(result.promptMessages.at(-1)?.content);

      expect(content).toContain(`home=${getBotHomeDir(bot)}`);
      expect(content).toMatch(/proxy=http:\/\/127\.0\.0\.1:\d+ node=1/);
    } finally {
      await stopEgressProxy();
    }
  });
});

const VAULT_VALUE = "ghp_vaultvalue123";
const GITHUB_SECRET = [{ name: "GitHub token", variable: "GH_TOKEN" }];
const VAULT_UNAVAILABLE = "Error: The vault is only available in the user's own conversations.";

async function createVaultFixture(username: string) {
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
  const entry = createVaultEntry(user.id, { name: "GitHub token", secret: VAULT_VALUE });
  const fixture = {
    user,
    conversation,
    entry,
    onApproval: undefined as ((actionId: string) => void) | undefined,
    onActionStart: vi.fn(async (action: RuntimeAction) => {
      const persisted = createMessageAction({ messageId: message.id, ...action });
      if (persisted.kind === "tool_approval") fixture.onApproval?.(persisted.id);
      return persisted.id;
    }),
    onActionComplete: vi.fn(),
    onActionError: vi.fn(),
    context(toolApproval: { userId: string | null; unattended: boolean }, conversationId: string | null = conversation.id) {
      return {
        input: {
          conversationId: conversationId ?? undefined,
          toolApproval,
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
    },
    persistedActions() {
      return getDb().prepare("SELECT * FROM message_actions WHERE message_id = ?").all(message.id) as Array<{
        kind: string;
        arguments_json: string | null;
      }>;
    },
    recordedPayloads() {
      return JSON.stringify([
        fixture.onActionStart.mock.calls,
        fixture.onActionComplete.mock.calls,
        fixture.onActionError.mock.calls,
        fixture.persistedActions()
      ]);
    }
  };
  return fixture;
}

describe("shell command vault secrets", () => {
  beforeEach(() => {
    botsMock.getBotByConversationId.mockReturnValue(null);
    vi.mocked(executeLocalShellCommand).mockClear();
  });

  it("passes vault secrets to the command as env and hides the value from everything recorded", async () => {
    const fixture = await createVaultFixture("vault-shell-env");
    createToolApprovalRules(fixture.user.id, "shell", ["echo"]);
    const command = 'echo "token=$GH_TOKEN length=${#GH_TOKEN}"';

    const result = await executeShellCommand(
      "tc_vault_env",
      { command, secrets: GITHUB_SECRET },
      fixture.context({ userId: fixture.user.id, unattended: true })
    );
    const content = String(result.promptMessages.at(-1)?.content);

    expect(executeLocalShellCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command, secretEnv: { GH_TOKEN: VAULT_VALUE } })
    );
    expect(content).toContain(`token=[hidden secret] length=${VAULT_VALUE.length}`);
    expect(content).not.toContain(VAULT_VALUE);
    expect(fixture.startedActions()).toEqual([
      expect.objectContaining({ kind: "shell_command", arguments: { command, timeoutMs: undefined, secrets: GITHUB_SECRET } })
    ]);
    expect(fixture.onActionComplete).toHaveBeenCalledTimes(1);
    expect(fixture.recordedPayloads()).not.toContain(VAULT_VALUE);
    expect(JSON.parse(fixture.persistedActions()[0].arguments_json ?? "")).toEqual({ command, secrets: GITHUB_SECRET });
    expect(getVaultEntry(fixture.user.id, fixture.entry.id)?.lastUsedAt).toEqual(expect.any(String));
    expect(redactSecrets(fixture.conversation.id, `x ${VAULT_VALUE} y`)).toBe("x [hidden secret] y");
  });

  it("asks for approval with the secret names and variables but never the value", async () => {
    const fixture = await createVaultFixture("vault-shell-approval");
    fixture.onApproval = (actionId) => approveToolApproval(actionId, undefined, fixture.user.id);
    const command = 'echo "auth=$GH_TOKEN"';

    const result = await executeShellCommand(
      "tc_vault_approval",
      { command, secrets: [{ name: "github TOKEN", variable: "GH_TOKEN" }] },
      fixture.context({ userId: fixture.user.id, unattended: false })
    );
    const approval = fixture.startedActions().find((action) => action.kind === "tool_approval");
    const payload = approval?.proposalPayload as ToolApprovalProposalPayload;

    expect(payload).toMatchObject({ scope: "shell", command, arguments: { secrets: GITHUB_SECRET } });
    expect(describeToolApprovalSecrets(payload)).toBe("GitHub token as $GH_TOKEN");
    expect(executeLocalShellCommand).toHaveBeenCalledWith(
      expect.objectContaining({ secretEnv: { GH_TOKEN: VAULT_VALUE } })
    );
    expect(String(result.promptMessages.at(-1)?.content)).toContain("auth=[hidden secret]");
    expect(JSON.stringify(result.promptMessages)).not.toContain(VAULT_VALUE);
    expect(fixture.recordedPayloads()).not.toContain(VAULT_VALUE);
  });

  it("does not read the vault when the command is denied", async () => {
    const fixture = await createVaultFixture("vault-shell-denied");
    const command = 'echo "$GH_TOKEN"';

    const result = await executeShellCommand(
      "tc_vault_denied",
      { command, secrets: GITHUB_SECRET },
      fixture.context({ userId: fixture.user.id, unattended: true })
    );

    expect(executeLocalShellCommand).not.toHaveBeenCalled();
    expect(String(result.promptMessages.at(-1)?.content)).toContain("Denied");
    expect(fixture.startedActions()).toEqual([
      expect.objectContaining({ kind: "shell_command", arguments: { command, timeoutMs: undefined, secrets: GITHUB_SECRET } })
    ]);
    expect(getVaultEntry(fixture.user.id, fixture.entry.id)?.lastUsedAt).toBeNull();
    expect(redactSecrets(fixture.conversation.id, VAULT_VALUE)).toBe(VAULT_VALUE);
  });

  it("rejects unknown, reserved, duplicate and malformed secrets before asking for approval", async () => {
    const fixture = await createVaultFixture("vault-shell-invalid");
    const cases: Array<[unknown, string]> = [
      [[{ name: "Missing", variable: "TOKEN" }], 'Error: There is no secret called "Missing". Call list_secrets to see the names.'],
      [[{ name: "GitHub token", variable: "PATH" }], "Error: PATH is reserved by Eidon or the shell. Pick another variable name."],
      [[{ name: "GitHub token", variable: "LD_PRELOAD" }], "Error: LD_PRELOAD is reserved by Eidon or the shell. Pick another variable name."],
      [[{ name: "GitHub token", variable: "AGENT_BROWSER_SESSION" }], "Error: AGENT_BROWSER_SESSION is reserved by Eidon or the shell. Pick another variable name."],
      [[{ name: "GitHub token", variable: "gh-token" }], 'Error: "gh-token" isn\'t a valid variable name. Use capitals, digits and underscores, e.g. API_TOKEN.'],
      [[...GITHUB_SECRET, ...GITHUB_SECRET], "Error: GH_TOKEN is used twice."],
      ["GH_TOKEN", "Error: secrets must be a list of { name, variable } objects."],
      [[{ name: "GitHub token" }], "Error: secrets must be a list of { name, variable } objects."],
      [[null], "Error: secrets must be a list of { name, variable } objects."]
    ];

    for (const [secrets, expected] of cases) {
      const result = await executeShellCommand(
        "tc_vault_invalid",
        { command: 'echo "$TOKEN"', secrets },
        fixture.context({ userId: fixture.user.id, unattended: false })
      );
      expect(result.promptMessages.at(-1)?.content).toBe(expected);
      expect(result.nextSortOrder).toBe(0);
    }

    expect(fixture.onActionStart).not.toHaveBeenCalled();
    expect(executeLocalShellCommand).not.toHaveBeenCalled();
    expect(getVaultEntry(fixture.user.id, fixture.entry.id)?.lastUsedAt).toBeNull();
  });

  it("refuses vault secrets outside the user's own conversations", async () => {
    const fixture = await createVaultFixture("vault-shell-owner");

    const withoutUser = await executeShellCommand(
      "tc_vault_no_user",
      { command: 'echo "$GH_TOKEN"', secrets: GITHUB_SECRET },
      fixture.context({ userId: null, unattended: false })
    );
    const withoutConversation = await executeShellCommand(
      "tc_vault_no_conversation",
      { command: 'echo "$GH_TOKEN"', secrets: GITHUB_SECRET },
      fixture.context({ userId: fixture.user.id, unattended: false }, null)
    );

    expect(withoutUser.promptMessages.at(-1)?.content).toBe(VAULT_UNAVAILABLE);
    expect(withoutConversation.promptMessages.at(-1)?.content).toBe(VAULT_UNAVAILABLE);
    expect(fixture.onActionStart).not.toHaveBeenCalled();
    expect(executeLocalShellCommand).not.toHaveBeenCalled();
  });

  it("runs without vault arguments when secrets is empty", async () => {
    const fixture = await createVaultFixture("vault-shell-empty");
    createToolApprovalRules(fixture.user.id, "shell", ["echo"]);

    const result = await executeShellCommand(
      "tc_vault_empty",
      { command: "echo plain", secrets: [] },
      fixture.context({ userId: fixture.user.id, unattended: true })
    );

    expect(String(result.promptMessages.at(-1)?.content)).toContain("plain");
    expect(executeLocalShellCommand).toHaveBeenCalledWith(expect.objectContaining({ secretEnv: undefined }));
    expect(fixture.startedActions()).toEqual([
      expect.objectContaining({ kind: "shell_command", arguments: { command: "echo plain", timeoutMs: undefined } })
    ]);
  });

  it("stops before running when an entry leaves the vault while approval is pending", async () => {
    const fixture = await createVaultFixture("vault-shell-deleted");
    fixture.onApproval = (actionId) => {
      deleteVaultEntry(fixture.user.id, fixture.entry.id);
      approveToolApproval(actionId, undefined, fixture.user.id);
    };

    const result = await executeShellCommand(
      "tc_vault_deleted",
      { command: 'echo "$GH_TOKEN"', secrets: GITHUB_SECRET },
      fixture.context({ userId: fixture.user.id, unattended: false })
    );

    expect(executeLocalShellCommand).not.toHaveBeenCalled();
    expect(result.promptMessages.at(-1)?.content).toBe('Error: "GitHub token" is no longer in the vault.');
    expect(fixture.onActionError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resultSummary: '"GitHub token" is no longer in the vault.' })
    );
  });

  it("hides the value from a failed execution's error", async () => {
    const fixture = await createVaultFixture("vault-shell-error");
    createToolApprovalRules(fixture.user.id, "shell", ["echo"]);
    vi.mocked(executeLocalShellCommand).mockRejectedValueOnce(new Error(`spawn failed with ${VAULT_VALUE}`));

    const result = await executeShellCommand(
      "tc_vault_error",
      { command: 'echo "$GH_TOKEN"', secrets: GITHUB_SECRET },
      fixture.context({ userId: fixture.user.id, unattended: true })
    );

    expect(result.promptMessages.at(-1)?.content).toBe("Error: spawn failed with [hidden secret]");
    expect(fixture.onActionError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resultSummary: "spawn failed with [hidden secret]" })
    );
    expect(fixture.recordedPayloads()).not.toContain(VAULT_VALUE);
  });
});
