import { describe, expect, it, vi } from "vitest";

import {
  createConversation,
  createMessage,
  createMessageAction
} from "@/lib/conversations";
import type { ToolApprovalProposalPayload } from "@/lib/types";
import type { RuntimeAction } from "@/lib/tool-executors";
import { createLocalUser } from "@/lib/users";

describe("tool approval waiter registry", () => {
  it("settles a pending request decided through a separate module instance", async () => {
    const user = await createLocalUser({
      username: "cross-instance-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation(undefined, undefined, undefined, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0
    });

    const first = await import("@/lib/tool-approvals");
    const started: string[] = [];
    const onActionStart = vi.fn(async (action: RuntimeAction) => {
      const persisted = createMessageAction({ messageId: message.id, ...action });
      started.push(persisted.id);
      return persisted.id;
    });

    const payload: ToolApprovalProposalPayload = {
      operation: "tool_approval",
      scope: "shell",
      families: ["curl"],
      classified: true,
      command: "curl https://cross-instance.example"
    };
    const pending = first.requestToolExecutionApproval({
      payload,
      label: 'Allow "curl" commands?',
      detail: payload.command ?? "",
      userId: user.id,
      unattended: false,
      onActionStart,
      timeoutMs: 5_000
    });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    vi.resetModules();
    const second = await import("@/lib/tool-approvals");
    second.approveToolApproval(started[0], undefined, user.id);

    expect(await pending).toEqual({ approved: true });
    expect(second.listToolApprovalRules(user.id)).toHaveLength(0);
  });
});
