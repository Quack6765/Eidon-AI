import { describe, expect, it } from "vitest";
import { reconcileSnapshotMessages } from "@/components/chat-snapshot-helpers";
import type { Message, MessageAction } from "@/lib/types";

function makeMessage(overrides: Partial<Message> & { id: string }): Message {
  return {
    conversationId: "conv_1",
    role: "user",
    content: "hello",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0,
    systemKind: null,
    compactedAt: null,
    createdAt: "2026-06-12T00:00:00.000Z",
    ...overrides
  } as Message;
}

describe("reconcileSnapshotMessages identity preservation", () => {
  it("returns the same message object when the snapshot copy is equivalent", () => {
    const current = [makeMessage({ id: "m1" }), makeMessage({ id: "m2", role: "assistant", content: "hi" })];
    const snapshot = [
      makeMessage({ id: "m1" }),
      makeMessage({ id: "m2", role: "assistant", content: "hi" })
    ];
    const result = reconcileSnapshotMessages(current, snapshot, null, []);
    expect(result.messages[0]).toBe(current[0]);
    expect(result.messages[1]).toBe(current[1]);
  });

  it("returns the current array identity when nothing changed", () => {
    const current = [makeMessage({ id: "m1" })];
    const snapshot = [makeMessage({ id: "m1" })];
    const result = reconcileSnapshotMessages(current, snapshot, null, []);
    expect(result.messages).toBe(current);
  });

  it("returns the snapshot copy when content changed", () => {
    const current = [makeMessage({ id: "m1", content: "old" })];
    const snapshot = [makeMessage({ id: "m1", content: "new" })];
    const result = reconcileSnapshotMessages(current, snapshot, null, []);
    expect(result.messages[0]).not.toBe(current[0]);
    expect(result.messages[0].content).toBe("new");
  });

  it("returns the snapshot copy when actions changed", () => {
    const makeAction = (detail: string): MessageAction => ({
      id: "a1",
      messageId: "m1",
      kind: "shell_command",
      status: "completed",
      serverId: null,
      skillId: null,
      toolName: null,
      label: "Run command",
      detail,
      arguments: null,
      resultSummary: "",
      sortOrder: 0,
      startedAt: "2026-06-12T00:00:00.000Z",
      completedAt: null,
      proposalState: null,
      proposalPayload: null,
      proposalUpdatedAt: null
    });
    const current = [makeMessage({ id: "m1", actions: [makeAction("ls")] })];
    const snapshot = [makeMessage({ id: "m1", actions: [makeAction("ls -la")] })];
    const result = reconcileSnapshotMessages(current, snapshot, null, []);
    expect(result.messages[0]).not.toBe(current[0]);
    expect(result.messages[0].actions?.[0]?.detail).toBe("ls -la");
  });

  it("returns the snapshot copy when estimatedTokens changed", () => {
    const current = [makeMessage({ id: "m1", estimatedTokens: 10 })];
    const snapshot = [makeMessage({ id: "m1", estimatedTokens: 25 })];
    const result = reconcileSnapshotMessages(current, snapshot, null, []);
    expect(result.messages[0]).not.toBe(current[0]);
    expect(result.messages[0].estimatedTokens).toBe(25);
  });

  it("still remaps pending local submissions to server messages", () => {
    const current = [makeMessage({ id: "local_1", content: "sent" })];
    const snapshot = [makeMessage({ id: "srv_1", content: "sent" })];
    const result = reconcileSnapshotMessages(current, snapshot, null, [
      { localMessageId: "local_1", content: "sent", attachments: [], serverMessageId: null }
    ]);
    expect(result.anchorMessageIdRemap.get("local_1")).toBe("srv_1");
    expect(result.messages.map((m) => m.id)).toEqual(["srv_1"]);
  });
});
