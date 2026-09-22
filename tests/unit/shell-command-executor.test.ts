import { realpathSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { Bot, PromptMessage } from "@/lib/types";

const botsMock = vi.hoisted(() => ({
  getBotByConversationId: vi.fn<(conversationId: string) => Bot | null>()
}));

vi.mock("@/lib/bots", () => ({
  getBotByConversationId: botsMock.getBotByConversationId
}));

function buildContext(conversationId: string) {
  return {
    input: { conversationId },
    timelineSortOrder: 0,
    promptMessages: [] as PromptMessage[]
  };
}

describe("shell command executor sandboxing", () => {
  it("runs non-bot commands in the conversation workspace, not the app root", async () => {
    botsMock.getBotByConversationId.mockReturnValue(null);
    const { executeShellCommand } = await import("@/lib/tool-executors");
    const { resolveShellWorkspaceDir } = await import("@/lib/local-shell");

    const result = await executeShellCommand(
      "tc_workspace",
      { command: "pwd" },
      buildContext("conv_exec_probe")
    );
    const content = String(result.promptMessages.at(-1)?.content);
    const resultLine = content.trimEnd().split("\n").at(-1);

    expect(resultLine).toBe(realpathSync(resolveShellWorkspaceDir("conv_exec_probe")));
    expect(resultLine).not.toBe(process.cwd());
  });

  it("keeps bot commands in the per-bot workspace with the browser sandbox env", async () => {
    const bot = { id: "bot_exec_probe", userId: "user_exec_probe" } as Bot;
    botsMock.getBotByConversationId.mockReturnValue(bot);
    const { executeShellCommand } = await import("@/lib/tool-executors");
    const { getBotWorkspaceDir } = await import("@/lib/bot-sandbox");

    const result = await executeShellCommand(
      "tc_bot",
      { command: 'pwd; echo "session=$AGENT_BROWSER_SESSION_NAME"; echo "secret=[$EIDON_SESSION_SECRET]"' },
      buildContext("conv_bot_probe")
    );
    const content = String(result.promptMessages.at(-1)?.content);

    expect(content).toContain(realpathSync(getBotWorkspaceDir(bot)));
    expect(content).toContain("session=bot");
    expect(content).toContain("secret=[]");
  });
});
