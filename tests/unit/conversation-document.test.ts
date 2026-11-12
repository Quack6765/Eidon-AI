import { describe, expect, it } from "vitest";

import {
  applyConversationDocumentEvent,
  completeStreamingThinkingPhase,
  createConversationDocument,
  ensureStreamingThinkingPhase,
  reconcileSnapshotMessages,
  selectNeedsMessageSync,
  selectRedirectingIds,
  selectRenderableMessages,
  type ConversationDocument,
  type ConversationDocumentEffect,
  type ConversationDocumentEvent
} from "@/components/conversation-document";
import type {
  Conversation,
  Message,
  MessageAction,
  MessageTimelineItem,
  QueuedMessage
} from "@/lib/types";
import type { ServerMessage } from "@/lib/ws-protocol";

const FIXED_NOW = 1_763_000_000_000;

function makeNow(start = FIXED_NOW) {
  let current = start;
  return () => current;
}

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

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv_1",
    title: "Test conversation",
    titleGenerationStatus: "completed",
    folderId: null,
    providerProfileId: "profile_default",
    reasoningEffort: null,
    automationId: null,
    automationRunId: null,
    conversationOrigin: "manual",
    sortOrder: 0,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    isActive: false,
    shareEnabled: false,
    shareToken: null,
    sharedAt: null,
    isTemporary: false,
    ...overrides
  } as Conversation;
}

function makeAction(overrides: Partial<MessageAction> & { id: string }): MessageAction {
  return {
    messageId: "msg_a",
    kind: "shell_command",
    status: "running",
    serverId: null,
    skillId: null,
    toolName: null,
    label: "Run command",
    detail: "ls",
    arguments: null,
    resultSummary: "",
    sortOrder: 0,
    startedAt: "2026-06-12T00:00:00.000Z",
    completedAt: null,
    proposalState: null,
    proposalPayload: null,
    proposalUpdatedAt: null,
    ...overrides
  } as MessageAction;
}

function makeQueuedMessage(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: "queue_1",
    conversationId: "conv_1",
    content: "Follow-up",
    status: "pending",
    sortOrder: 0,
    failureMessage: null,
    mode: "chat",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    processingStartedAt: null,
    ...overrides
  } as QueuedMessage;
}

type Harness = {
  state: () => ConversationDocument;
  apply: (event: ConversationDocumentEvent) => ConversationDocumentEffect[];
  server: (message: ServerMessage) => ConversationDocumentEffect[];
};

function createHarness(): Harness {
  let state = createConversationDocument({
    conversationId: "conv_1",
    messages: [],
    queuedMessages: [],
    title: "Test conversation",
    titleGenerationStatus: "completed",
    isActive: false,
    contextTokens: null,
    compactionLimit: 12800
  });
  const now = makeNow();
  const apply = (event: ConversationDocumentEvent) => {
    const transition = applyConversationDocumentEvent(state, event, { now });
    state = transition.state;
    return transition.effects;
  };
  return {
    state: () => state,
    apply,
    server: (message: ServerMessage) => apply({ type: "server_message", message })
  };
}

function effectKinds(effects: ConversationDocumentEffect[]) {
  return effects.map((effect) => effect.kind);
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
    const current = [makeMessage({ id: "m1", actions: [makeAction({ id: "a1", detail: "ls" })] })];
    const snapshot = [makeMessage({ id: "m1", actions: [makeAction({ id: "a1", detail: "ls -la" })] })];
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

describe("streaming thinking phases", () => {
  it("completes a phase in place and appends resumed thinking after the tool", () => {
    const firstPhase = ensureStreamingThinkingPhase(
      [],
      "msg_assistant",
      0,
      "2026-07-27T12:00:00.000Z"
    );
    const repeatedDelta = ensureStreamingThinkingPhase(
      firstPhase,
      "msg_assistant",
      8,
      "2026-07-27T12:00:00.500Z"
    );
    const completedPhase = completeStreamingThinkingPhase(
      repeatedDelta,
      16,
      "completed",
      "2026-07-27T12:00:01.000Z"
    );
    const toolAction: MessageTimelineItem = {
      id: "act_search",
      messageId: "msg_assistant",
      timelineKind: "action",
      kind: "mcp_tool_call",
      status: "completed",
      serverId: "exa",
      skillId: null,
      toolName: "web_search_exa",
      label: "Web search",
      detail: "query=Eidon",
      arguments: { query: "Eidon" },
      resultSummary: "Found results",
      sortOrder: 1,
      startedAt: "2026-07-27T12:00:01.000Z",
      completedAt: "2026-07-27T12:00:02.000Z",
      proposalState: null,
      proposalPayload: null,
      proposalUpdatedAt: null
    };
    const resumedPhase = ensureStreamingThinkingPhase(
      [...completedPhase, toolAction],
      "msg_assistant",
      16,
      "2026-07-27T12:00:02.000Z"
    );

    expect(repeatedDelta).toBe(firstPhase);
    expect(resumedPhase.map((item) => item.timelineKind)).toEqual([
      "thinking",
      "action",
      "thinking"
    ]);
    expect(resumedPhase[0]).toEqual(
      expect.objectContaining({
        id: "stream_thinking_msg_assistant_0",
        status: "completed",
        endOffset: 16
      })
    );
    expect(resumedPhase[2]).toEqual(
      expect.objectContaining({
        id: "stream_thinking_msg_assistant_1",
        status: "running",
        startOffset: 16
      })
    );
  });
});

describe("conversation document snapshot ordering", () => {
  it("adopts a streaming message from a snapshot and continues appending deltas without duplication", () => {
    const h = createHarness();
    h.server({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        makeMessage({
          id: "msg_a",
          role: "assistant",
          status: "streaming",
          thinkingContent: "so far",
          timeline: [
            {
              id: "t1",
              messageId: "msg_a",
              timelineKind: "thinking",
              status: "running",
              sortOrder: 0,
              startOffset: 0,
              endOffset: null,
              startedAt: "2026-06-12T00:00:00.000Z",
              completedAt: null
            }
          ]
        })
      ],
      actions: [],
      segments: [],
      queuedMessages: []
    });

    expect(h.state().streamMessageId).toBe("msg_a");
    expect(h.state().streamThinkingTarget).toBe("so far");
    expect(h.state().isSending).toBe(true);

    h.server({ type: "delta", conversationId: "conv_1", event: { type: "thinking_delta", text: " more" } });
    expect(h.state().streamThinkingTarget).toBe("so far more");
    expect(h.state().messages.filter((m) => m.id === "msg_a")).toHaveLength(1);
  });

  it("keeps the locally richer stream when a merge-mode snapshot repeats a shorter answer", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "local answer" } });

    h.server({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        makeMessage({
          id: "msg_a",
          role: "assistant",
          status: "streaming",
          content: "",
          timeline: []
        })
      ],
      actions: [],
      segments: [],
      queuedMessages: []
    });

    expect(h.state().streamAnswerTarget).toBe("local answer");
    expect(h.state().streamMessageId).toBe("msg_a");
  });

  it("drops an active stream a reconnect snapshot no longer contains", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "partial" } });

    const effects = h.server({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        makeMessage({ id: "msg_user", role: "user", content: "Write something long" }),
        makeMessage({ id: "msg_resumed", role: "assistant", content: "Final answer after the restart" })
      ],
      actions: [],
      segments: [],
      queuedMessages: []
    });

    expect(effectKinds(effects)).toContain("turn_ready_notification");
    expect(h.state().streamMessageId).toBeNull();
    expect(h.state().messages.map((m) => m.id)).toEqual(["msg_user", "msg_resumed"]);
    expect(h.state().isSending).toBe(false);
  });

  it("ignores a stale empty snapshot while a stream is running", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "partial" } });

    h.server({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [],
      actions: [],
      segments: [],
      queuedMessages: []
    });

    expect(h.state().streamMessageId).toBe("msg_a");
    expect(h.state().messages.map((m) => m.id)).toEqual(["msg_a"]);
  });
});

describe("conversation document finalize ordering", () => {
  it("finalizes on done and defers the stream clear to the drain callback", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "final text" } });

    const doneEffects = h.server({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "done", messageId: "msg_a" }
    });

    expect(effectKinds(doneEffects)).toEqual(
      expect.arrayContaining(["stream_buffer_finalize", "stream_buffer_drain_awaited"])
    );
    expect(h.state().finalizePending).toBe(true);
    expect(h.state().streamMessageId).toBe("msg_a");
    expect(h.state().messages[0].content).toBe("final text");
    expect(h.state().messages[0].status).toBe("completed");
    expect(h.state().isSending).toBe(false);

    const drainEffects = h.apply({ type: "stream_drained" });
    expect(effectKinds(drainEffects)).toContain("turn_ready_notification");
    expect(h.state().finalizePending).toBe(false);
    expect(h.state().streamMessageId).toBeNull();
    expect(h.state().streamTimeline).toEqual([]);
  });

  it("ignores an ended-stream snapshot while the drain is pending", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "done", messageId: "msg_a" } });
    expect(h.state().finalizePending).toBe(true);

    h.server({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        makeMessage({ id: "msg_a", role: "assistant", status: "completed", content: "final text" })
      ],
      actions: [],
      segments: [],
      queuedMessages: []
    });

    expect(h.state().streamMessageId).toBe("msg_a");
    expect(h.state().finalizePending).toBe(true);

    h.apply({ type: "stream_drained" });
    expect(h.state().streamMessageId).toBeNull();
    expect(h.state().messages[0].status).toBe("completed");
  });

  it("clears the stream immediately when a stopped turn is done", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.apply({ type: "stop_requested" });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "done", messageId: "msg_a" } });

    expect(h.state().messages[0].status).toBe("stopped");
    expect(h.state().streamMessageId).toBeNull();
    expect(h.state().finalizePending).toBe(false);
  });
});

describe("conversation document optimistic submission reconciliation", () => {
  function submit(h: Harness, content = "hello") {
    const effects = h.apply({ type: "submission_started", content, attachments: [] });
    const submission = h.state().pendingLocalSubmissions[0];
    return { effects, submission };
  }

  it("replaces the optimistic message in place when user_message_persisted arrives", () => {
    const h = createHarness();
    const { submission } = submit(h);
    expect(h.state().messages.map((m) => m.id)).toEqual([submission.localMessageId]);
    expect(h.state().pendingAnchorMessageId).toBe(submission.localMessageId);

    h.server({
      type: "user_message_persisted",
      conversationId: "conv_1",
      message: makeMessage({ id: "srv_1", role: "user", content: "hello" })
    });

    expect(h.state().messages.map((m) => m.id)).toEqual(["srv_1"]);
    expect(h.state().pendingLocalSubmissions).toEqual([]);
    expect(h.state().renderKeyByMessageId.get("srv_1")).toBe(submission.localMessageId);
    expect(h.state().pendingAnchorMessageId).toBe("srv_1");
  });

  it("ignores a duplicate user_message_persisted for the same server message", () => {
    const h = createHarness();
    submit(h);
    const persisted: ServerMessage = {
      type: "user_message_persisted",
      conversationId: "conv_1",
      message: makeMessage({ id: "srv_1", role: "user", content: "hello" })
    };
    h.server(persisted);
    const afterFirst = h.state().messages;
    h.server(persisted);
    expect(h.state().messages).toBe(afterFirst);
    expect(h.state().messages.map((m) => m.id)).toEqual(["srv_1"]);
  });

  it("keeps an optimistic message visible when an unrelated server user message arrives first", () => {
    const h = createHarness();
    const { submission } = submit(h, "mine");

    h.server({
      type: "user_message_persisted",
      conversationId: "conv_1",
      message: makeMessage({ id: "srv_other", role: "user", content: "something else" })
    });

    expect(h.state().messages.map((m) => m.id)).toEqual([submission.localMessageId, "srv_other"]);
    expect(selectRenderableMessages(h.state(), new Set()).map((m) => m.id)).toEqual([
      submission.localMessageId,
      "srv_other"
    ]);
    expect(selectNeedsMessageSync(h.state())).toBe(true);
  });

  it("reconciles a partial-attachment snapshot and completes it on the fuller snapshot", () => {
    const h = createHarness();
    const attachments = [
      { id: "att_1", conversationId: "conv_1", messageId: null, filename: "a.png", mimeType: "image/png", byteSize: 1, sha256: "h1", relativePath: "conv_1/a.png", kind: "image" as const, extractedText: "", createdAt: "2026-06-12T00:00:00.000Z" },
      { id: "att_2", conversationId: "conv_1", messageId: null, filename: "b.png", mimeType: "image/png", byteSize: 1, sha256: "h2", relativePath: "conv_1/b.png", kind: "image" as const, extractedText: "", createdAt: "2026-06-12T00:00:00.000Z" }
    ];
    h.apply({ type: "submission_started", content: "with files", attachments });
    const submission = h.state().pendingLocalSubmissions[0];

    h.server({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        makeMessage({
          id: "srv_1",
          role: "user",
          content: "with files",
          attachments: [attachments[0]]
        })
      ],
      actions: [],
      segments: [],
      queuedMessages: []
    });

    expect(h.state().pendingLocalSubmissions).toHaveLength(1);
    expect(h.state().pendingLocalSubmissions[0].serverMessageId).toBe("srv_1");
    expect(h.state().renderKeyByMessageId.get("srv_1")).toBe(submission.localMessageId);

    h.server({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        makeMessage({ id: "srv_1", role: "user", content: "with files", attachments })
      ],
      actions: [],
      segments: [],
      queuedMessages: []
    });

    expect(h.state().pendingLocalSubmissions).toEqual([]);
    expect(h.state().messages.map((m) => m.id)).toEqual(["srv_1"]);
  });

  it("restores the composer when a websocket error lands without an active stream", () => {
    const h = createHarness();
    const { submission } = submit(h);

    const effects = h.server({ type: "error", message: "boom" });

    expect(h.state().messages).toEqual([]);
    expect(h.state().pendingLocalSubmissions).toEqual([]);
    expect(effectKinds(effects)).toContain("composer_restored");
    const restored = effects.find((effect) => effect.kind === "composer_restored");
    expect(restored && restored.kind === "composer_restored" ? restored.submission.localMessageId : null).toBe(
      submission.localMessageId
    );
  });
});

describe("conversation document turn lifecycle", () => {
  it("marks the streaming message error and clears the stream on a stream error event", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "partial" } });

    const effects = h.server({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "error", message: "provider exploded" }
    });

    expect(h.state().messages[0].status).toBe("error");
    expect(h.state().messages[0].content).toBe("provider exploded");
    expect(h.state().streamMessageId).toBeNull();
    expect(h.state().isSending).toBe(false);
    expect(h.state().isActive).toBe(false);
    expect(effectKinds(effects)).toContain("error_cleared");
    expect(effectKinds(effects)).toContain("conversation_activity_broadcast");
  });

  it("removes empty error assistant messages when a follow-up turn succeeds", () => {
    const h = createHarness();
    h.apply({
      type: "payload_changed",
      messages: [
        makeMessage({ id: "err_1", role: "assistant", status: "error", content: "", createdAt: "2026-06-12T00:00:01.000Z" }),
        makeMessage({ id: "keep_1", role: "user", content: "question", createdAt: "2026-06-12T00:00:02.000Z" })
      ]
    });

    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "done", messageId: "msg_a", message: makeMessage({ id: "msg_a", role: "assistant", content: "answer" }) }
    });

    expect(h.state().messages.map((m) => m.id)).toEqual(["keep_1", "msg_a"]);
  });

  it("keeps the server timeline when done carries a message with segments", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "streamed" } });
    const serverTimeline: MessageTimelineItem[] = [
      { id: "text_1", timelineKind: "text", sortOrder: 0, createdAt: "2026-06-12T00:00:03.000Z", content: "server text" }
    ];
    h.server({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "done",
        messageId: "msg_a",
        message: makeMessage({ id: "msg_a", role: "assistant", content: "server text", timeline: serverTimeline })
      }
    });

    expect(h.state().messages[0].timeline).toBe(serverTimeline);
  });

  it("resets the compaction indicator when compaction ends and on downstream activity", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "compaction_start" } });
    expect(h.state().compactionInProgress).toBe(true);
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "compaction_end" } });
    expect(h.state().compactionInProgress).toBe(false);

    h.server({ type: "delta", conversationId: "conv_1", event: { type: "compaction_start" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    expect(h.state().compactionInProgress).toBe(true);
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "thinking_delta", text: "hm" } });
    expect(h.state().compactionInProgress).toBe(false);
  });

  it("clears the answer target on answer_reset", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "rethink this" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_reset" } });
    expect(h.state().streamAnswerTarget).toBe("");
  });

  it("resets the stream buffer targets and timeline on stream_retry", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "attempt one" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "stream_retry", attempt: 1 } });

    expect(h.state().streamAnswerTarget).toBe("");
    expect(h.state().streamTimeline).toEqual([]);
    expect(h.state().finalizePending).toBe(false);
  });

  it("computes thinking duration once on the first answer delta after thinking", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "thinking_delta", text: "hmm" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "a" } });
    const duration = h.state().thinkingDuration;
    expect(duration).toBe(0);
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "b" } });
    expect(h.state().thinkingDuration).toBe(duration);
  });

  it("slices streamed text into the timeline when an action starts", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "before tool" } });
    h.server({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "action_start", action: makeAction({ id: "act_1", messageId: "msg_a" }) }
    });

    expect(h.state().streamTimeline.map((item) => item.timelineKind)).toEqual(["text", "action"]);
    const text = h.state().streamTimeline[0] as Extract<MessageTimelineItem, { timelineKind: "text" }>;
    expect(text.content).toBe("before tool");

    h.server({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "action_start", action: makeAction({ id: "act_1", messageId: "msg_a", status: "completed" }) }
    });
    expect(h.state().streamTimeline).toHaveLength(2);
  });
});

describe("conversation document conversation sync merging", () => {
  it("ignores a stale inactive poll result while local stream state exists", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "thinking_delta", text: "working" } });

    const effects = h.apply({
      type: "conversation_synced",
      conversation: makeConversation({ isActive: false }),
      messages: [
        makeMessage({ id: "msg_a", role: "assistant", status: "streaming", thinkingContent: "working" })
      ]
    });

    expect(effectKinds(effects)).not.toContain("message_sync_stopped");
    expect(h.state().isActive).toBe(true);
    expect(h.state().streamMessageId).toBe("msg_a");
  });

  it("settles the turn when the server reports the conversation inactive", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "answer_delta", text: "half" } });

    const effects = h.apply({
      type: "conversation_synced",
      conversation: makeConversation({ isActive: false }),
      messages: [
        makeMessage({ id: "msg_a", role: "assistant", status: "completed", content: "full answer" })
      ]
    });

    expect(effectKinds(effects)).toContain("message_sync_stopped");
    expect(h.state().messages[0].content).toBe("full answer");
    expect(h.state().streamMessageId).toBeNull();
    expect(h.state().isActive).toBe(false);
    expect(h.state().isSending).toBe(false);
  });

  it("adopts a running turn from a poll result when no local stream exists", () => {
    const h = createHarness();
    const effects = h.apply({
      type: "conversation_synced",
      conversation: makeConversation({ isActive: true }),
      messages: [
        makeMessage({
          id: "msg_a",
          role: "assistant",
          status: "streaming",
          content: "",
          timeline: [
            { id: "t_1", timelineKind: "text", sortOrder: 0, createdAt: "2026-06-12T00:00:00.000Z", content: "joined text" },
            { ...makeAction({ id: "act_1", status: "completed" }), timelineKind: "action", sortOrder: 1 } as MessageTimelineItem
          ]
        })
      ]
    });

    expect(h.state().streamMessageId).toBe("msg_a");
    expect(h.state().streamAnswerTarget).toBe("joined text");
    expect(h.state().isSending).toBe(true);
    expect(effectKinds(effects)).toContain("stream_buffer_set_answer");
  });

  it("keeps polling-aware senders waiting for the turn to start", () => {
    const h = createHarness();
    h.apply({ type: "submission_started", content: "hello", attachments: [] });
    expect(selectNeedsMessageSync(h.state())).toBe(true);

    const effects = h.apply({
      type: "conversation_synced",
      conversation: makeConversation({ isActive: false }),
      messages: []
    });

    expect(effectKinds(effects)).not.toContain("message_sync_stopped");
    expect(h.state().isSending).toBe(true);
  });
});

describe("conversation document queue and title events", () => {
  it("hydrates queued messages from snapshot and queue updates", () => {
    const h = createHarness();
    const queued = [makeQueuedMessage({ id: "queue_1" })];
    h.server({ type: "snapshot", conversationId: "conv_1", messages: [], actions: [], segments: [], queuedMessages: queued });
    expect(h.state().queuedMessages).toEqual(queued);

    const updated = [makeQueuedMessage({ id: "queue_1", status: "processing" })];
    h.server({ type: "queue_updated", conversationId: "conv_1", queuedMessages: updated });
    expect(h.state().queuedMessages).toEqual(updated);
  });

  it("marks queued messages as redirecting when sent now or when steering is enabled", () => {
    const h = createHarness();
    h.server({
      type: "queue_updated",
      conversationId: "conv_1",
      queuedMessages: [makeQueuedMessage({ id: "queue_1" }), makeQueuedMessage({ id: "queue_2" })]
    });
    h.apply({ type: "queued_message_send_now_requested", queuedMessageId: "queue_2" });

    expect([...selectRedirectingIds(h.state(), false)]).toEqual(["queue_2"]);
    expect([...selectRedirectingIds(h.state(), true)]).toEqual(["queue_1", "queue_2"]);

    h.server({
      type: "queue_updated",
      conversationId: "conv_1",
      queuedMessages: [makeQueuedMessage({ id: "queue_2", status: "processing" })]
    });
    expect([...selectRedirectingIds(h.state(), true)]).toEqual([]);
  });

  it("updates the title and stops polling when conversation_title_updated arrives", () => {
    const h = createHarness();
    const effects = h.server({ type: "conversation_title_updated", conversationId: "conv_1", title: "Fresh title" });
    expect(h.state().title).toBe("Fresh title");
    expect(h.state().titleGenerationStatus).toBe("completed");
    expect(effectKinds(effects)).toContain("conversation_title_broadcast");
    expect(effectKinds(effects)).toContain("title_polling_stopped");
  });

  it("broadcasts a title change from a poll result only when the title differs", () => {
    const h = createHarness();
    const first = h.apply({ type: "title_synced", conversation: makeConversation({ title: "Polled" }) });
    expect(effectKinds(first)).toContain("conversation_title_broadcast");
    expect(h.state().title).toBe("Polled");

    const second = h.apply({ type: "title_synced", conversation: makeConversation({ title: "Polled" }) });
    expect(effectKinds(second)).not.toContain("conversation_title_broadcast");
  });

  it("halts the title poll loop once the status settles", () => {
    const h = createHarness();
    const effects = h.apply({
      type: "title_synced",
      conversation: makeConversation({ titleGenerationStatus: "completed" })
    });
    const stop = effects.find((effect) => effect.kind === "title_polling_stopped");
    expect(stop?.kind === "title_polling_stopped" ? stop.haltsPollLoop : null).toBe(true);
  });

  it("ignores server messages for other conversations", () => {
    const h = createHarness();
    const before = h.state();
    h.server({ type: "queue_updated", conversationId: "conv_other", queuedMessages: [makeQueuedMessage()] });
    h.server({ type: "conversation_title_updated", conversationId: "conv_other", title: "Other" });
    h.server({
      type: "snapshot",
      conversationId: "conv_other",
      messages: [makeMessage({ id: "m1" })],
      actions: [],
      segments: [],
      queuedMessages: []
    });
    h.server({ type: "conversation_cleared", conversationId: "conv_other" });
    h.server({ type: "delta", conversationId: "conv_other", event: { type: "message_start", messageId: "msg_a" } });
    expect(h.state()).toBe(before);
  });
});

describe("conversation document lifecycle events", () => {
  it("derives activity from the ready message", () => {
    const h = createHarness();
    h.server({
      type: "ready",
      activeConversations: [{ id: "conv_1", title: "Test conversation", status: "streaming" }]
    });
    expect(h.state().isActive).toBe(true);

    h.server({ type: "ready", activeConversations: [] });
    expect(h.state().isActive).toBe(false);
  });

  it("clears everything on conversation_cleared", () => {
    const h = createHarness();
    h.apply({
      type: "payload_changed",
      messages: [makeMessage({ id: "m1" })],
      queuedMessages: [makeQueuedMessage()]
    });
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "context_usage", contextTokens: 500, compactionLimit: 900, memoriesUsed: 2, memoriesTotal: 4 } });

    const effects = h.server({ type: "conversation_cleared", conversationId: "conv_1" });

    expect(h.state().messages).toEqual([]);
    expect(h.state().queuedMessages).toEqual([]);
    expect(h.state().usedTokens).toBeNull();
    expect(h.state().memoryUsage).toEqual({ used: 2, total: 4 });
    expect(h.state().isActive).toBe(false);
    expect(h.state().isSending).toBe(false);
    expect(effectKinds(effects)).toContain("token_usage_stored");
    expect(effectKinds(effects)).toContain("error_cleared");
  });

  it("removes deleted messages", () => {
    const h = createHarness();
    h.apply({ type: "payload_changed", messages: [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })] });
    h.server({ type: "messages_deleted", conversationId: "conv_1", messageIds: ["m1"] });
    expect(h.state().messages.map((m) => m.id)).toEqual(["m2"]);
  });

  it("tracks token usage from context_usage events", () => {
    const h = createHarness();
    const effects = h.server({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "context_usage", contextTokens: 1200, compactionLimit: 2000 }
    });
    expect(h.state().usedTokens).toBe(1200);
    expect(h.state().compactionLimit).toBe(2000);
    expect(h.state().memoryUsage).toBeNull();
    expect(effectKinds(effects)).toContain("token_usage_stored");
  });

  it("shows an error for queued-message operation failures without touching the stream", () => {
    const h = createHarness();
    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_a" } });
    const before = h.state();
    const effects = h.server({ type: "error", message: "Queued message not found" });
    expect(h.state()).toBe(before);
    expect(effectKinds(effects)).toEqual(["error_shown"]);
  });

  it("restores pending submissions and stops sending when the transport fails", () => {
    const h = createHarness();
    h.apply({ type: "submission_started", content: "hello", attachments: [] });
    const effects = h.apply({ type: "transport_failed", errorMessage: "offline" });
    expect(h.state().messages).toEqual([]);
    expect(h.state().isSending).toBe(false);
    expect(effectKinds(effects)).toEqual(
      expect.arrayContaining(["composer_restored", "error_shown"])
    );
  });
});

describe("conversation document turn restarts", () => {
  it("resets stream state and captures a baseline when an edit restart begins", () => {
    const h = createHarness();
    h.apply({ type: "payload_changed", messages: [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })] });
    h.apply({ type: "message_edit_started", messageId: "m1" });

    expect(h.state().isSending).toBe(true);
    expect(h.state().pendingAnchorMessageId).toBe("m1");
    expect([...(h.state().restartBaselineMessageIds ?? [])]).toEqual(["m1", "m2"]);
  });

  it("applies the restart result while keeping messages added after the baseline", () => {
    const h = createHarness();
    h.apply({ type: "payload_changed", messages: [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })] });
    h.apply({ type: "message_retry_started", messageId: "m2" });

    h.server({ type: "delta", conversationId: "conv_1", event: { type: "message_start", messageId: "msg_new" } });

    h.apply({
      type: "turn_restart_succeeded",
      conversation: makeConversation({ title: "Retried" }),
      messages: [makeMessage({ id: "m1", content: "kept" })]
    });

    expect(h.state().messages.map((m) => m.id)).toEqual(["m1", "msg_new"]);
    expect(h.state().title).toBe("Retried");
  });

  it("marks the conversation active and sending when a regenerate succeeds", () => {
    const h = createHarness();
    h.apply({ type: "message_regenerate_started", messageId: "m1" });
    const effects = h.apply({
      type: "turn_restart_succeeded",
      conversation: makeConversation(),
      messages: [makeMessage({ id: "m1" })],
      active: true,
      sending: true
    });

    expect(h.state().isActive).toBe(true);
    expect(h.state().isSending).toBe(true);
    expect(effectKinds(effects)).toContain("conversation_activity_broadcast");
  });

  it("clears the sending flag when an edit restart fails", () => {
    const h = createHarness();
    h.apply({ type: "message_edit_started", messageId: "m1" });
    const effects = h.apply({ type: "turn_restart_failed", error: "nope", clearSending: true });
    expect(h.state().isSending).toBe(false);
    expect(effectKinds(effects)).toEqual(["error_shown"]);
  });

  it("leaves sending untouched when a regenerate fails", () => {
    const h = createHarness();
    h.apply({ type: "message_regenerate_started", messageId: "m1" });
    h.apply({ type: "turn_restart_failed", error: "nope", clearSending: false });
    expect(h.state().isSending).toBe(false);
  });
});

describe("conversation document selectors", () => {
  it("hides a local user message once its server twin exists", () => {
    const h = createHarness();
    h.apply({ type: "submission_started", content: "hello", attachments: [] });
    const localId = h.state().messages[0].id;

    h.apply({
      type: "payload_changed",
      messages: [makeMessage({ id: "srv_1", role: "user", content: "hello" })]
    });

    const renderable = selectRenderableMessages(h.state(), new Set());
    expect(renderable.some((m) => m.id === localId)).toBe(false);
  });

  it("drops rewound messages from the renderable list", () => {
    const h = createHarness();
    h.apply({ type: "payload_changed", messages: [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })] });
    const renderable = selectRenderableMessages(h.state(), new Set(["m1"]));
    expect(renderable.map((m) => m.id)).toEqual(["m2"]);
  });

  it("detects an active turn from activity, stream, or streaming messages", () => {
    const h = createHarness();
    expect(selectHasActiveTurnState(h)).toBe(false);
    h.apply({ type: "research_turn_started" });
    expect(selectHasActiveTurnState(h)).toBe(true);
    h.apply({ type: "research_turn_failed" });

    h.apply({
      type: "payload_changed",
      messages: [makeMessage({ id: "msg_a", role: "assistant", status: "streaming" })]
    });
    expect(selectHasActiveTurnState(h)).toBe(true);
  });

  function selectHasActiveTurnState(h: Harness) {
    const document = h.state();
    return (
      document.isActive ||
      Boolean(document.streamMessageId && !document.finalizePending) ||
      document.messages.some((m) => m.role === "assistant" && m.status === "streaming")
    );
  }
});
