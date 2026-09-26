import { realpathSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { Bot, PromptMessage } from "@/lib/types";
import { createLocalUser } from "@/lib/users";

const botsMock = vi.hoisted(() => ({
  getBotByConversationId: vi.fn<(conversationId: string) => Bot | null>()
}));

vi.mock("@/lib/bots", () => ({
  getBotByConversationId: botsMock.getBotByConversationId
}));

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

    expect(content).toContain(`session=user-${user.id}`);
    expect(content).toContain(`agent-browser/users/${user.id}`);
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
    expect(content).toContain("session=bot-bot_exec_probe");
    expect(content).toContain("secret=[]");
  });
});
