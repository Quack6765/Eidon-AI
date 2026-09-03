import { describe, expect, it, vi } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import { createMessage } from "@/lib/conversations";
import {
  approveMemoryProposal,
  buildCreateMemoryProposal,
  buildDeleteMemoryProposal,
  buildUpdateMemoryProposal
} from "@/lib/memory-proposals";
import { createMemory, getMemory, listMemories } from "@/lib/memories";
import {
  executeCreateMemory,
  executeDeleteMemory,
  executeUpdateMemory
} from "@/lib/tool-executors";
import type { PromptMessage } from "@/lib/types";

function buildMemoryContext(memoryUserId: string | null, conversationId?: string) {
  const actions: Array<{ kind: string; status: string; proposalPayload: unknown }> = [];
  return {
    context: {
      memoryUserId,
      input: {
        conversationId,
        onActionStart: async (action: { kind: string; status?: string; proposalPayload?: unknown }) => {
          actions.push({ kind: action.kind, status: action.status ?? "running", proposalPayload: action.proposalPayload });
          return "action_mem";
        }
      },
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    },
    actions
  };
}

describe("memory tool bot scoping", () => {
  it("proposes bot-pool memories from bot conversations", async () => {
    const user = await createLocalUser({ username: "memtoolbot", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Mem Bot" }, user.id);

    const { context, actions } = buildMemoryContext(user.id, bot.homeConversationId);
    const result = await executeCreateMemory("call_m1", { content: "bot fact", category: "work" }, context);

    const payload = actions[0]?.proposalPayload as { botId?: string | null };
    expect(payload?.botId).toBe(bot.id);
    expect(result.promptMessages.at(-1)?.content).toContain("proposed for approval");
  });

  it("proposes main-pool memories from normal conversations", async () => {
    const user = await createLocalUser({ username: "memtoolmain", password: "password-123", role: "user" as const });

    const { context, actions } = buildMemoryContext(user.id, "conv_plain");
    await executeCreateMemory("call_m2", { content: "main fact", category: "work" }, context);

    const payload = actions[0]?.proposalPayload as { botId?: string | null };
    expect(payload?.botId).toBeUndefined();
  });

  it("blocks bots from touching main-pool memories on update/delete", async () => {
    const user = await createLocalUser({ username: "memtoolguard", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Guard Mem" }, user.id);
    const mainMemory = createMemory("main entry", "work", user.id);

    const update = await executeUpdateMemory(
      "call_m3",
      { id: mainMemory.id, content: "hijack" },
      buildMemoryContext(user.id, bot.homeConversationId).context
    );
    expect(update.promptMessages.at(-1)?.content).toContain("read-only for bots");

    const del = await executeDeleteMemory(
      "call_m4",
      { id: mainMemory.id },
      buildMemoryContext(user.id, bot.homeConversationId).context
    );
    expect(del.promptMessages.at(-1)?.content).toContain("read-only for bots");
    expect(getMemory(mainMemory.id, user.id)).not.toBeNull();
  });

  it("allows bots to update their own pool memories", async () => {
    const user = await createLocalUser({ username: "memtoolown", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Own Mem" }, user.id);
    const botMemory = createMemory("bot entry", "work", user.id, { botId: bot.id });

    const { context, actions } = buildMemoryContext(user.id, bot.homeConversationId);
    const result = await executeUpdateMemory(
      "call_m5",
      { id: botMemory.id, content: "bot entry v2" },
      context
    );

    expect(result.promptMessages.at(-1)?.content).toContain("proposed for approval");
    const payload = actions[0]?.proposalPayload as { botId?: string | null };
    expect(payload?.botId).toBe(bot.id);
  });
});

describe("memory proposal approval with bot scope", () => {
  it("creates approved bot memories in the bot pool", async () => {
    const { createMessageAction } = await import("@/lib/conversations");
    const user = await createLocalUser({ username: "memapprove", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Approve Bot" }, user.id);

    const assistantMessage = createMessage({
      conversationId: bot.homeConversationId,
      role: "assistant",
      content: ""
    });
    const action = createMessageAction({
      messageId: assistantMessage.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: buildCreateMemoryProposal({
        content: "approved bot fact",
        category: "work",
        botId: bot.id
      })
    });

    const approved = approveMemoryProposal(action.id, undefined, user.id);
    expect(approved.proposalState).toBe("approved");

    expect(listMemories(user.id, undefined, { botId: bot.id }).map((m) => m.content)).toEqual([
      "approved bot fact"
    ]);
    expect(listMemories(user.id)).toEqual([]);
  });

  it("approving a bot-scoped update only touches the bot pool", async () => {
    const { createMessageAction } = await import("@/lib/conversations");
    const user = await createLocalUser({ username: "memapproveupd", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Approve Upd" }, user.id);
    const botMemory = createMemory("stale bot fact", "work", user.id, { botId: bot.id });

    const assistantMessage = createMessage({
      conversationId: bot.homeConversationId,
      role: "assistant",
      content: ""
    });
    const action = createMessageAction({
      messageId: assistantMessage.id,
      kind: "update_memory",
      status: "pending",
      label: "Update memory proposal",
      proposalState: "pending",
      proposalPayload: buildUpdateMemoryProposal({
        memory: botMemory,
        content: "fresh bot fact",
        botId: bot.id
      })
    });

    approveMemoryProposal(action.id, undefined, user.id);

    expect(getMemory(botMemory.id, user.id, { botId: bot.id })?.content).toBe("fresh bot fact");
    expect(listMemories(user.id)).toEqual([]);
  });

  it("approving a bot-scoped delete removes only the bot memory", async () => {
    const { createMessageAction } = await import("@/lib/conversations");
    const user = await createLocalUser({ username: "memapprovedel", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Approve Del" }, user.id);
    const botMemory = createMemory("doomed bot fact", "work", user.id, { botId: bot.id });
    const mainMemory = createMemory("main keeper", "work", user.id);

    const assistantMessage = createMessage({
      conversationId: bot.homeConversationId,
      role: "assistant",
      content: ""
    });
    const action = createMessageAction({
      messageId: assistantMessage.id,
      kind: "delete_memory",
      status: "pending",
      label: "Delete memory proposal",
      proposalState: "pending",
      proposalPayload: buildDeleteMemoryProposal(botMemory, bot.id)
    });

    approveMemoryProposal(action.id, undefined, user.id);

    expect(getMemory(botMemory.id, user.id, { botId: bot.id })).toBeNull();
    expect(getMemory(mainMemory.id, user.id)).not.toBeNull();
  });
});
