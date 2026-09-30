import { describe, expect, it } from "vitest";
import {
  delegationActionBotName,
  delegationSentMessage,
  isDelegationActionKind,
  matchDelegationReplies,
  parseDelegationWakeMessage,
  type DelegationAction
} from "@/lib/delegation-marker";
import type { Message } from "@/lib/types";

const DELIVERY_NOTICE =
  "\n---\n(Automated delivery: this is the reply from the bot you messaged earlier with message_bot. Process it silently and report the outcome to the user in your answer.)";

function action(overrides: Partial<DelegationAction> = {}): DelegationAction {
  return {
    timelineKind: "action",
    id: "action_1",
    messageId: "msg_assistant",
    kind: "message_bot",
    status: "pending",
    serverId: null,
    skillId: null,
    toolName: "message_bot",
    label: "Messaged Researcher",
    detail: "",
    arguments: null,
    resultSummary: "",
    sortOrder: 0,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    proposalState: null,
    proposalPayload: null,
    proposalUpdatedAt: null,
    ...overrides
  };
}

describe("isDelegationActionKind", () => {
  it("covers message_bot and the legacy delegate_task", () => {
    expect(isDelegationActionKind("message_bot")).toBe(true);
    expect(isDelegationActionKind("delegate_task")).toBe(true);
    expect(isDelegationActionKind("update_bot")).toBe(false);
    expect(isDelegationActionKind("mcp_tool_call")).toBe(false);
  });
});

describe("delegationActionBotName", () => {
  it("reads the bot name from the Messaged label", () => {
    expect(delegationActionBotName(action())).toBe("Researcher");
  });

  it("falls back to the bot argument when the label does not match", () => {
    expect(delegationActionBotName(action({ label: "Sent something", arguments: { bot: " Writer " } }))).toBe(
      "Writer"
    );
  });

  it("resolves legacy delegate_task rows", () => {
    expect(
      delegationActionBotName(action({ kind: "delegate_task", toolName: "delegate_task" }))
    ).toBe("Researcher");
  });

  it("returns an empty string when the bot cannot be resolved", () => {
    expect(delegationActionBotName(action({ label: "Messaged", arguments: null }))).toBe("");
    expect(delegationActionBotName(action({ label: "", arguments: { bot: 7 } }))).toBe("");
  });
});

describe("delegationSentMessage", () => {
  it("prefers the message argument", () => {
    expect(
      delegationSentMessage(action({ arguments: { message: "  Check the Q3 model.  " }, detail: "ignored" }))
    ).toBe("Check the Q3 model.");
  });

  it("falls back to the legacy task_prompt argument", () => {
    expect(delegationSentMessage(action({ kind: "delegate_task", arguments: { task_prompt: "Summarise it." } }))).toBe(
      "Summarise it."
    );
  });

  it("falls back to the detail line with its arrow prefix stripped", () => {
    expect(delegationSentMessage(action({ arguments: null, detail: "→ Researcher: Review the draft." }))).toBe(
      "Review the draft."
    );
  });

  it("returns an empty string when nothing carries the sent text", () => {
    expect(delegationSentMessage(action({ arguments: null, detail: "" }))).toBe("");
    expect(delegationSentMessage(action({ arguments: { message: "   " }, detail: "→ Researcher: " }))).toBe("");
  });
});

describe("parseDelegationWakeMessage", () => {
  it("returns null for content that is not a delegation marker", () => {
    expect(parseDelegationWakeMessage("hello there")).toBeNull();
    expect(parseDelegationWakeMessage("[Message from ]\nbody")).toBeNull();
  });

  it("strips the internal automated delivery notice from the payload", () => {
    const parsed = parseDelegationWakeMessage(
      `[Message from Researcher]\nFound 3 sources.${DELIVERY_NOTICE}`
    );

    expect(parsed).toEqual({
      botName: "Researcher",
      content: "Found 3 sources.",
      failed: false
    });
  });

  it("keeps a separator that is not the automated delivery notice", () => {
    const parsed = parseDelegationWakeMessage("[Message from Researcher]\nStep one.\n---\nStep two.");

    expect(parsed?.content).toBe("Step one.\n---\nStep two.");
  });

  it("flags the failure shape", () => {
    const parsed = parseDelegationWakeMessage(
      `[Message from Researcher]\nThe task failed: timed out.${DELIVERY_NOTICE}`
    );

    expect(parsed?.failed).toBe(true);
    expect(parsed?.content).toBe("The task failed: timed out.");
  });

  it("does not flag a payload that merely mentions a failure", () => {
    expect(parseDelegationWakeMessage("[Message from Researcher]\nNo task failed here.")?.failed).toBe(false);
  });
});

describe("matchDelegationReplies", () => {
  const assistant = (id: string, actions: DelegationAction[]): Message =>
    ({
      id,
      role: "assistant",
      content: "",
      timeline: actions
    }) as Message;
  const user = (id: string, content: string): Message =>
    ({
      id,
      role: "user",
      content
    }) as Message;

  it("pairs a chip with the action it answers", () => {
    const index = matchDelegationReplies([
      assistant("msg_a", [action({ id: "action_1" })]),
      user("msg_wake", "[Message from Researcher]\nThe answer.")
    ]);

    expect(index.links.get("msg_wake")).toEqual({
      actionId: "action_1",
      parentMessageId: "msg_assistant"
    });
    expect(index.repliedActionIds.has("action_1")).toBe(true);
  });

  it("pairs two messages to the same bot in send order", () => {
    const index = matchDelegationReplies([
      assistant("msg_a", [action({ id: "action_1" })]),
      assistant("msg_b", [action({ id: "action_2" })]),
      user("msg_wake_1", "[Message from Researcher]\nFirst answer."),
      user("msg_wake_2", "[Message from Researcher]\nSecond answer.")
    ]);

    expect(index.links.get("msg_wake_1")?.actionId).toBe("action_1");
    expect(index.links.get("msg_wake_2")?.actionId).toBe("action_2");
  });

  it("never cross-matches two bots messaged in parallel", () => {
    const index = matchDelegationReplies([
      assistant("msg_a", [
        action({ id: "action_researcher", label: "Messaged Researcher" }),
        action({ id: "action_writer", label: "Messaged Writer", sortOrder: 1 })
      ]),
      user("msg_wake_writer", "[Message from Writer]\nDraft ready."),
      user("msg_wake_researcher", "[Message from Researcher]\nThree sources.")
    ]);

    expect(index.links.get("msg_wake_writer")?.actionId).toBe("action_writer");
    expect(index.links.get("msg_wake_researcher")?.actionId).toBe("action_researcher");
  });

  it("does not reuse an already answered action", () => {
    const index = matchDelegationReplies([
      assistant("msg_a", [action({ id: "action_1" })]),
      user("msg_wake_1", "[Message from Researcher]\nFirst."),
      user("msg_wake_2", "[Message from Researcher]\nSecond.")
    ]);

    expect(index.links.get("msg_wake_1")?.actionId).toBe("action_1");
    expect(index.links.has("msg_wake_2")).toBe(false);
  });

  it("leaves a chip with no preceding action unlinked", () => {
    const index = matchDelegationReplies([user("msg_wake", "[Message from Researcher]\nAnswer.")]);

    expect(index.links.size).toBe(0);
    expect(index.repliedActionIds.size).toBe(0);
  });

  it("skips actions whose bot cannot be resolved", () => {
    const index = matchDelegationReplies([
      assistant("msg_a", [action({ id: "action_1", label: "Messaged", arguments: null })]),
      user("msg_wake", "[Message from Researcher]\nAnswer.")
    ]);

    expect(index.links.size).toBe(0);
  });

  it("skips messages with no timeline and non-delegation actions", () => {
    const index = matchDelegationReplies([
      assistant("msg_a", [action({ id: "action_1", kind: "update_bot", toolName: "update_bot" })]),
      assistant("msg_b", []),
      user("msg_wake", "[Message from Researcher]\nAnswer.")
    ]);

    expect(index.links.size).toBe(0);
  });
});
