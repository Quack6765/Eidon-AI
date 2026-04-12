import { describe, expect, it } from "vitest";
import { groupCompletedTurns, renderCompletedTurns } from "@/lib/compaction-turns";
import type { Message, MessageAction } from "@/lib/types";

function makeAction(overrides: Partial<MessageAction> & Pick<MessageAction, "id" | "messageId" | "label" | "detail" | "resultSummary">): MessageAction {
  return {
    kind: "mcp_tool_call",
    status: "completed",
    serverId: null,
    skillId: null,
    toolName: "execute_shell_command",
    sortOrder: 0,
    startedAt: "2026-04-10T10:00:00.000Z",
    completedAt: "2026-04-10T10:00:01.000Z",
    arguments: { command: "npm run test -- --verbose" },
    proposalState: null,
    proposalPayload: null,
    proposalUpdatedAt: null,
    ...overrides
  };
}

function makeMessage(
  overrides: Partial<Message> & Pick<Message, "id" | "role" | "content" | "status">
): Message {
  return {
    conversationId: "conv_1",
    thinkingContent: "",
    estimatedTokens: 10,
    systemKind: null,
    compactedAt: null,
    createdAt: "2026-04-10T10:00:00.000Z",
    actions: [],
    attachments: [],
    ...overrides
  };
}

describe("compaction turns", () => {
  it("groups completed turns across empty streaming placeholders in the middle", () => {
    const messages: Message[] = [
      makeMessage({
        id: "msg_1",
        role: "user",
        content: "Plan the rollout",
        status: "completed"
      }),
      makeMessage({
        id: "msg_2",
        role: "assistant",
        content: "Use a staged release.",
        status: "completed"
      }),
      makeMessage({
        id: "msg_3",
        role: "assistant",
        content: "",
        thinkingContent: "",
        status: "streaming"
      }),
      makeMessage({
        id: "msg_4",
        role: "user",
        content: "And keep a rollback plan ready.",
        status: "completed"
      }),
      makeMessage({
        id: "msg_5",
        role: "assistant",
        content: "Document the rollback path.",
        status: "completed"
      })
    ];

    const turns = groupCompletedTurns(messages);
    const rendered = renderCompletedTurns(messages);

    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.assistant.id)).toEqual(["msg_2", "msg_5"]);
    expect(rendered).toContain("Use a staged release.");
    expect(rendered).toContain("Document the rollback path.");
    expect(rendered).not.toContain("msg_3");
  });

  it("keeps tool result summaries concise and strips multiline log content", () => {
    const messages: Message[] = [
      makeMessage({
        id: "msg_1",
        role: "user",
        content: "Run the command",
        status: "completed"
      }),
      makeMessage({
        id: "msg_2",
        role: "assistant",
        content: "Done.",
        status: "completed",
        actions: [
          makeAction({
            id: "act_1",
            messageId: "msg_2",
            label: "Shell command",
            detail: "npm test",
            resultSummary: "Applied patch to plan.md\n---\nlog line 1\nlog line 2"
          })
        ]
      })
    ];

    const rendered = renderCompletedTurns(messages);

    expect(rendered).toContain("result: Applied patch to plan.md");
    expect(rendered).not.toContain("log line 1");
    expect(rendered).not.toContain("log line 2");
    expect(rendered).not.toContain("---");
  });

  it("groups a completed user turn and keeps tool result summaries without raw details", () => {
    const messages: Message[] = [
      makeMessage({
        id: "msg_1",
        role: "user",
        content: "Plan the rollout",
        status: "completed"
      }),
      makeMessage({
        id: "msg_2",
        role: "assistant",
        content: "Use a staged release.",
        thinkingContent: "Internal reasoning that should not persist",
        status: "completed",
        actions: [
          makeAction({
            id: "act_1",
            messageId: "msg_2",
            label: "Local command",
            detail: "npm run test -- --verbose",
            resultSummary: "Tests passed"
          })
        ]
      }),
      makeMessage({
        id: "msg_3",
        role: "assistant",
        content: "",
        thinkingContent: "",
        status: "streaming"
      })
    ];

    const turns = groupCompletedTurns(messages);
    const rendered = renderCompletedTurns(messages);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.user.id).toBe("msg_1");
    expect(turns[0]?.assistant.id).toBe("msg_2");
    expect(rendered).toContain("Plan the rollout");
    expect(rendered).toContain("Use a staged release.");
    expect(rendered).toContain("Tests passed");
    expect(rendered).not.toContain("Internal reasoning that should not persist");
    expect(rendered).not.toContain("npm run test -- --verbose");
    expect(rendered).not.toContain("msg_3");
  });
});
