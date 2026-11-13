import type {
  ChatStreamEvent,
  Conversation,
  Message,
  MessageAction,
  MessageAttachment,
  MessageTimelineItem,
  QueuedMessage
} from "@/lib/types";
import type { ServerMessage } from "@/lib/ws-protocol";

export type SnapshotReconciliation = {
  messages: Message[];
  pendingLocalSubmissions: PendingLocalSubmission[];
  anchorMessageIdRemap: Map<string, string>;
};

export type PendingLocalSubmission = {
  localMessageId: string;
  content: string;
  attachments: MessageAttachment[];
  serverMessageId: string | null;
};

export function getAttachmentIdSignature(attachments: MessageAttachment[] | undefined) {
  return [...(attachments ?? []).map((attachment) => attachment.id)].sort().join("\u0000");
}

export function matchesPendingLocalSubmission(
  message: Message,
  submission: PendingLocalSubmission
) {
  return (
    message.role === "user" &&
    message.content === submission.content &&
    getAttachmentIdSignature(message.attachments) ===
      getAttachmentIdSignature(submission.attachments)
  );
}

function attachmentsAreSubset(
  candidateAttachments: MessageAttachment[] | undefined,
  submissionAttachments: MessageAttachment[]
) {
  const submissionAttachmentIds = new Set(submissionAttachments.map((attachment) => attachment.id));
  return (candidateAttachments ?? []).every((attachment) =>
    submissionAttachmentIds.has(attachment.id)
  );
}

export function appendStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  const existingIndex = timeline.findIndex(
    (item) => item.timelineKind === "action" && item.id === action.id
  );

  if (existingIndex === -1) {
    return [...timeline, { ...action, timelineKind: "action" }];
  }

  return timeline.map((item, index) =>
    index === existingIndex ? { ...action, timelineKind: "action" } : item
  );
}

export function updateStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  return appendStreamingAction(timeline, action);
}

export function ensureStreamingThinkingPhase(
  timeline: MessageTimelineItem[],
  messageId: string,
  startOffset: number,
  startedAt: string
): MessageTimelineItem[] {
  const lastItem = timeline.at(-1);

  if (lastItem?.timelineKind === "thinking" && lastItem.status === "running") {
    return timeline;
  }

  const phaseIndex = timeline.filter((item) => item.timelineKind === "thinking").length;

  return [
    ...timeline,
    {
      id: `stream_thinking_${messageId}_${phaseIndex}`,
      messageId,
      timelineKind: "thinking",
      status: "running",
      sortOrder: timeline.length,
      startOffset,
      endOffset: null,
      startedAt,
      completedAt: null
    }
  ];
}

export function completeStreamingThinkingPhase(
  timeline: MessageTimelineItem[],
  endOffset: number,
  status: "completed" | "error" | "stopped",
  completedAt: string
): MessageTimelineItem[] {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];

    if (item.timelineKind !== "thinking" || item.status !== "running") {
      continue;
    }

    return timeline.map((candidate, candidateIndex) =>
      candidateIndex === index
        ? {
            ...item,
            status,
            endOffset,
            completedAt
          }
        : candidate
    );
  }

  return timeline;
}

export function isLegacyCompactionNotice(message: Pick<Message, "role" | "systemKind">) {
  return message.role === "system" && message.systemKind === "compaction_notice";
}

export function sanitizeMessages(messages: Message[] | undefined) {
  if (!messages) return [];
  return messages.filter((message) => !isLegacyCompactionNotice(message));
}

function areMessagesEquivalent(left: Message, right: Message) {
  if (
    left.id !== right.id ||
    left.role !== right.role ||
    left.status !== right.status ||
    left.content !== right.content ||
    left.thinkingContent !== right.thinkingContent ||
    left.systemKind !== right.systemKind ||
    left.compactedAt !== right.compactedAt ||
    left.estimatedTokens !== right.estimatedTokens
  ) {
    return false;
  }

  if (getAttachmentIdSignature(left.attachments) !== getAttachmentIdSignature(right.attachments)) {
    return false;
  }

  return (
    JSON.stringify(left.timeline ?? null) === JSON.stringify(right.timeline ?? null) &&
    JSON.stringify(left.actions ?? null) === JSON.stringify(right.actions ?? null) &&
    JSON.stringify(left.textSegments ?? null) === JSON.stringify(right.textSegments ?? null)
  );
}

export function reconcileSnapshotMessages(
  current: Message[],
  snapshot: Message[] | undefined,
  activeStreamMessageId: string | null,
  pendingLocalSubmissions: PendingLocalSubmission[]
): SnapshotReconciliation {
  const sanitizedSnapshot = sanitizeMessages(snapshot);
  if (sanitizedSnapshot.length === 0) {
    return {
      messages: current.filter((message) => !isLegacyCompactionNotice(message)),
      pendingLocalSubmissions,
      anchorMessageIdRemap: new Map()
    };
  }

  const currentById = new Map(current.map((m) => [m.id, m] as const));

  const merged = sanitizedSnapshot.map((snapshotMsg) => {
    const currentMsg = currentById.get(snapshotMsg.id);

    if (currentMsg && currentMsg.id === activeStreamMessageId) {
      return currentMsg;
    }

    if (currentMsg && currentMsg.status === "completed" && snapshotMsg.status === "streaming") {
      return currentMsg;
    }

    if (currentMsg && areMessagesEquivalent(currentMsg, snapshotMsg)) {
      return currentMsg;
    }

    return snapshotMsg;
  });

  const snapshotMessageIds = new Set(sanitizedSnapshot.map((m) => m.id));
  const currentNonLocalIds = new Set(
    current.filter((m) => !m.id.startsWith("local_")).map((m) => m.id)
  );
  const confirmedLocalIds = new Set<string>();
  const claimedServerUserMessageIds = new Set<string>();
  const newServerUserMessages = sanitizedSnapshot.filter(
    (message) => message.role === "user" && !currentNonLocalIds.has(message.id)
  );
  const nextPendingLocalSubmissions = pendingLocalSubmissions.map((submission) => ({
    ...submission
  }));
  const anchorMessageIdRemap = new Map<string, string>();

  for (const submission of nextPendingLocalSubmissions) {
    if (
      submission.serverMessageId &&
      !sanitizedSnapshot.some((message) => message.id === submission.serverMessageId)
    ) {
      submission.serverMessageId = null;
    }

    const candidateServerUserMessages =
      submission.serverMessageId !== null
        ? sanitizedSnapshot.filter((message) => message.id === submission.serverMessageId)
        : newServerUserMessages.filter((message) => !claimedServerUserMessageIds.has(message.id));

    const matchedServerMessage = candidateServerUserMessages.find(
      (message) => matchesPendingLocalSubmission(message, submission)
    );

    if (!matchedServerMessage) {
      if (submission.attachments.length === 0 || submission.serverMessageId !== null) {
        continue;
      }

      const partialServerMessage = newServerUserMessages.find(
        (message) =>
          !claimedServerUserMessageIds.has(message.id) &&
          message.role === "user" &&
          message.content === submission.content &&
          attachmentsAreSubset(message.attachments, submission.attachments)
      );

      if (partialServerMessage) {
        submission.serverMessageId = partialServerMessage.id;
        anchorMessageIdRemap.set(submission.localMessageId, partialServerMessage.id);
        claimedServerUserMessageIds.add(partialServerMessage.id);
      }

      continue;
    }

    submission.serverMessageId = matchedServerMessage.id;
    anchorMessageIdRemap.set(submission.localMessageId, matchedServerMessage.id);
    confirmedLocalIds.add(submission.localMessageId);
    claimedServerUserMessageIds.add(matchedServerMessage.id);
  }

  const pendingLocalMessages = current.filter((m) => {
    if (snapshotMessageIds.has(m.id)) {
      return false;
    }

    if (confirmedLocalIds.has(m.id)) {
      return false;
    }

    return !isLegacyCompactionNotice(m);
  });

  const nextMessages = [...merged];
  for (const message of pendingLocalMessages) {
    const insertIndex = nextMessages.findIndex(
      (candidate) => candidate.createdAt > message.createdAt
    );
    if (insertIndex === -1) {
      nextMessages.push(message);
    } else {
      nextMessages.splice(insertIndex, 0, message);
    }
  }
  const unchanged =
    nextMessages.length === current.length &&
    nextMessages.every((message, index) => message === current[index]);

  return {
    messages: unchanged ? current : nextMessages,
    pendingLocalSubmissions: nextPendingLocalSubmissions.filter(
      (submission) => !confirmedLocalIds.has(submission.localMessageId)
    ),
    anchorMessageIdRemap
  };
}

export function adoptStreamingSnapshotState(timeline: MessageTimelineItem[] | undefined) {
  const consolidated: MessageTimelineItem[] = [];
  let textBuffer = "";
  let textCreatedAt: string | null = null;

  function flushBufferedText() {
    if (!textBuffer || !textCreatedAt) {
      return;
    }

    consolidated.push({
      id: `adopted_text_${consolidated.length}`,
      timelineKind: "text",
      sortOrder: consolidated.length,
      createdAt: textCreatedAt,
      content: textBuffer
    });
    textBuffer = "";
    textCreatedAt = null;
  }

  for (const item of timeline ?? []) {
    if (item.timelineKind === "text") {
      textBuffer += item.content;
      textCreatedAt ??= item.createdAt;
      continue;
    }

    flushBufferedText();
    consolidated.push(
      item.timelineKind === "thinking"
        ? { ...item, sortOrder: consolidated.length }
        : {
            ...item,
            timelineKind: "action",
            sortOrder: consolidated.length
          }
    );
  }

  flushBufferedText();

  const answer = consolidated
    .filter((item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> => item.timelineKind === "text")
    .map((item) => item.content)
    .join("");

  const lastItem = consolidated.at(-1);
  const closedTimeline = lastItem?.timelineKind === "text" ? consolidated.slice(0, -1) : consolidated;

  return {
    answer,
    timeline: closedTimeline
  };
}

export function mergeStreamingSnapshotTimeline(
  current: MessageTimelineItem[],
  snapshotTimeline: MessageTimelineItem[]
) {
  let nextTimeline = current;

  for (const item of snapshotTimeline) {
    if (item.timelineKind !== "action") {
      continue;
    }

    const { timelineKind: _timelineKind, ...action } = item;
    nextTimeline = updateStreamingAction(nextTimeline, action);
  }

  return nextTimeline;
}

export function replaceMessageAction(
  messages: Message[],
  nextAction: MessageAction
) {
  return messages.map((message) => {
    const nextActions = message.actions?.map((action) =>
      action.id === nextAction.id ? nextAction : action
    );
    const nextTimeline = message.timeline?.map((item) =>
      item.timelineKind === "action" && item.id === nextAction.id
        ? { ...nextAction, timelineKind: "action" as const }
        : item
    );

    if (nextActions === message.actions && nextTimeline === message.timeline) {
      return message;
    }

    return {
      ...message,
      ...(nextActions ? { actions: nextActions } : {}),
      ...(nextTimeline ? { timeline: nextTimeline } : {})
    };
  });
}

export function isQueuedMessageOperationError(message: string) {
  return message === "Queued message not found";
}

export type ConversationDocument = {
  conversationId: string;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  sendNowIds: ReadonlySet<string>;
  title: string;
  titleGenerationStatus: Conversation["titleGenerationStatus"];
  isActive: boolean;
  isSending: boolean;
  isStopPending: boolean;
  streamMessageId: string | null;
  streamTimeline: MessageTimelineItem[];
  streamAnswerTarget: string;
  streamThinkingTarget: string;
  hasReceivedFirstToken: boolean;
  compactionInProgress: boolean;
  usedTokens: number | null;
  compactionLimit: number;
  memoryUsage: { used: number; total: number } | null;
  thinkingStartedAt: number | null;
  thinkingDuration: number | undefined;
  finalizePending: boolean;
  finishedStreamMessageIds: ReadonlySet<string>;
  pendingLocalSubmissions: PendingLocalSubmission[];
  renderKeyByMessageId: ReadonlyMap<string, string>;
  pendingAnchorMessageId: string | null;
  restartBaselineMessageIds: ReadonlySet<string> | null;
};

export type ConversationDocumentSeed = {
  conversationId: string;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  title: string;
  titleGenerationStatus: Conversation["titleGenerationStatus"];
  isActive: boolean;
  contextTokens: number | null;
  compactionLimit: number;
};

export type ConversationDocumentEvent =
  | { type: "payload_changed"; messages?: Message[]; queuedMessages?: QueuedMessage[]; title?: string; isActive?: boolean; titleGenerationStatus?: Conversation["titleGenerationStatus"]; conversationId?: string; usedTokens?: number | null }
  | { type: "server_message"; message: ServerMessage }
  | { type: "conversation_synced"; conversation: Conversation; messages: Message[] }
  | { type: "title_synced"; conversation: Conversation }
  | { type: "submission_started"; content: string; attachments: MessageAttachment[] }
  | { type: "transport_failed"; errorMessage: string }
  | { type: "message_edit_started"; messageId: string }
  | { type: "message_retry_started"; messageId: string }
  | { type: "message_regenerate_started"; messageId: string }
  | { type: "turn_restart_succeeded"; conversation?: Conversation; messages?: Message[]; active?: boolean; sending?: boolean }
  | { type: "turn_restart_failed"; error: string; clearSending: boolean }
  | { type: "rewind_committed"; messages: Message[]; queuedMessages: QueuedMessage[] }
  | { type: "message_action_replaced"; action: MessageAction }
  | { type: "stream_action_replaced"; action: MessageAction }
  | { type: "stop_requested" }
  | { type: "queued_message_send_now_requested"; queuedMessageId: string }
  | { type: "research_message_persisted"; message: Message }
  | { type: "research_draft_discarded"; messageId: string }
  | { type: "research_turn_started" }
  | { type: "research_turn_failed" }
  | { type: "anchor_scrolled" }
  | { type: "stream_drained" };

export type ConversationDocumentEffect =
  | { kind: "stream_buffer_reset" }
  | { kind: "stream_buffer_append_thinking"; text: string }
  | { kind: "stream_buffer_append_answer"; text: string }
  | { kind: "stream_buffer_set_answer"; text: string; immediate: boolean }
  | { kind: "stream_buffer_set_thinking"; text: string; immediate: boolean }
  | { kind: "stream_buffer_finalize" }
  | { kind: "stream_buffer_drain_awaited" }
  | { kind: "turn_ready_notification" }
  | { kind: "conversation_activity_broadcast"; isActive: boolean }
  | { kind: "conversation_title_broadcast"; title: string }
  | { kind: "token_usage_stored"; tokens: number | null }
  | { kind: "composer_restored"; submission: PendingLocalSubmission }
  | { kind: "error_shown"; message: string }
  | { kind: "error_cleared" }
  | { kind: "rewind_cancelled"; reason: string }
  | { kind: "title_polling_stopped"; haltsPollLoop: boolean }
  | { kind: "message_sync_stopped" };

export type ConversationDocumentTransition = {
  state: ConversationDocument;
  effects: ConversationDocumentEffect[];
};

export type ConversationDocumentOptions = {
  now?: () => number;
};

const REWIND_CANCEL_REASON = "A new reply started, so the rewind was undone";

export function createConversationDocument(seed: ConversationDocumentSeed): ConversationDocument {
  return {
    conversationId: seed.conversationId,
    messages: sanitizeMessages(seed.messages),
    queuedMessages: seed.queuedMessages,
    sendNowIds: new Set(),
    title: seed.title,
    titleGenerationStatus: seed.titleGenerationStatus,
    isActive: seed.isActive,
    isSending: false,
    isStopPending: false,
    streamMessageId: null,
    streamTimeline: [],
    streamAnswerTarget: "",
    streamThinkingTarget: "",
    hasReceivedFirstToken: false,
    compactionInProgress: false,
    usedTokens: seed.contextTokens,
    compactionLimit: seed.compactionLimit,
    memoryUsage: null,
    thinkingStartedAt: null,
    thinkingDuration: undefined,
    finalizePending: false,
    finishedStreamMessageIds: new Set(),
    pendingLocalSubmissions: [],
    renderKeyByMessageId: new Map(),
    pendingAnchorMessageId: null,
    restartBaselineMessageIds: null
  };
}

type DocumentPatch = Partial<ConversationDocument>;

function withPatch(state: ConversationDocument, patch: DocumentPatch): ConversationDocument {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof ConversationDocument)[]) {
    if (state[key] !== patch[key]) {
      changed = true;
      break;
    }
  }
  return changed ? { ...state, ...patch } : state;
}

export function applyConversationDocumentEvent(
  state: ConversationDocument,
  event: ConversationDocumentEvent,
  options: ConversationDocumentOptions = {}
): ConversationDocumentTransition {
  const now = options.now ?? Date.now;
  const effects: ConversationDocumentEffect[] = [];
  const nextState = runEvent(state, event, now, effects);

  if (state.streamMessageId !== null && nextState.streamMessageId === null) {
    effects.push({ kind: "turn_ready_notification" });
  }

  return { state: nextState, effects };
}

function runEvent(
  state: ConversationDocument,
  event: ConversationDocumentEvent,
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  switch (event.type) {
    case "payload_changed":
      return applyPayloadChange(state, event);
    case "server_message":
      return applyServerMessage(state, event.message, now, effects);
    case "conversation_synced":
      return applyConversationSync(state, event.conversation, event.messages, now, effects);
    case "title_synced":
      return applyTitleSync(state, event.conversation, effects);
    case "submission_started":
      return applySubmissionStarted(state, event.content, event.attachments, now, effects);
    case "transport_failed":
      return applyTransportFailed(state, event.errorMessage, effects);
    case "message_edit_started":
      return applyTurnRestart(state, { pendingAnchorMessageId: event.messageId }, effects);
    case "message_retry_started":
      return applyTurnRestart(state, {}, effects);
    case "message_regenerate_started":
      return withPatch(state, {
        restartBaselineMessageIds: new Set(state.messages.map((message) => message.id))
      });
    case "turn_restart_succeeded":
      return applyTurnRestartResult(state, event, effects);
    case "turn_restart_failed":
      effects.push({ kind: "error_shown", message: event.error });
      return event.clearSending ? withPatch(state, { isSending: false }) : state;
    case "rewind_committed":
      return withPatch(state, {
        messages: sanitizeMessages(event.messages),
        queuedMessages: event.queuedMessages
      });
    case "message_action_replaced":
      return withPatch(state, { messages: replaceMessageAction(state.messages, event.action) });
    case "stream_action_replaced":
      return withPatch(state, {
        messages: replaceMessageAction(state.messages, event.action),
        streamTimeline: updateStreamingAction(state.streamTimeline, event.action)
      });
    case "stop_requested":
      return withPatch(state, { isStopPending: true });
    case "queued_message_send_now_requested":
      return withPatch(state, {
        sendNowIds: new Set(state.sendNowIds).add(event.queuedMessageId)
      });
    case "research_message_persisted":
      return withPatch(state, {
        messages: state.messages.some((message) => message.id === event.message.id)
          ? state.messages
          : [...state.messages, event.message]
      });
    case "research_draft_discarded":
      return withPatch(state, {
        messages: state.messages.filter((message) => message.id !== event.messageId)
      });
    case "research_turn_started":
      return withPatch(state, { isActive: true });
    case "research_turn_failed":
      return withPatch(state, { isActive: false });
    case "anchor_scrolled":
      return withPatch(state, { pendingAnchorMessageId: null });
    case "stream_drained":
      return clearStream(withPatch(state, { finalizePending: false }), effects, {});
    default:
      return state;
  }
}

function applyPayloadChange(
  state: ConversationDocument,
  event: Extract<ConversationDocumentEvent, { type: "payload_changed" }>
): ConversationDocument {
  let next = state;

  if (event.messages !== undefined) {
    const incoming = sanitizeMessages(event.messages);
    next = withPatch(next, {
      messages: next.messages.length === 0
        ? incoming
        : incoming.map((msg) => {
            const local = next.messages.find((m) => m.id === msg.id);
            if (state.streamMessageId && msg.id === state.streamMessageId && local?.status === "streaming") {
              return local;
            }
            if (msg.status !== "error" || msg.content) return msg;
            return local?.content ? { ...msg, content: local.content } : msg;
          })
    });
  }

  if (event.queuedMessages !== undefined) {
    next = withPatch(next, { queuedMessages: event.queuedMessages });
  }
  if (event.title !== undefined) {
    next = withPatch(next, { title: event.title });
  }
  if (event.isActive !== undefined) {
    next = withPatch(next, { isActive: event.isActive });
  }
  if (event.titleGenerationStatus !== undefined) {
    next = withPatch(next, { titleGenerationStatus: event.titleGenerationStatus });
  }
  if (event.conversationId !== undefined) {
    next = withPatch(next, { conversationId: event.conversationId });
  }
  if (event.usedTokens !== undefined) {
    next = withPatch(next, { usedTokens: event.usedTokens });
  }

  return next;
}

type StreamClearOptions = {
  hasReceivedFirstToken?: boolean;
  resetThinking?: boolean;
  isStopPending?: boolean;
  compaction?: boolean;
  isSending?: boolean;
};

function clearStream(
  state: ConversationDocument,
  effects: ConversationDocumentEffect[],
  options: StreamClearOptions
): ConversationDocument {
  effects.push({ kind: "stream_buffer_reset" });
  return withPatch(state, {
    streamMessageId: null,
    streamTimeline: [],
    streamAnswerTarget: "",
    streamThinkingTarget: "",
    ...(options.hasReceivedFirstToken ? { hasReceivedFirstToken: false } : {}),
    ...(options.resetThinking
      ? { thinkingStartedAt: null, thinkingDuration: undefined }
      : {}),
    ...(options.isStopPending ? { isStopPending: false } : {}),
    ...(options.compaction ? { compactionInProgress: false } : {}),
    ...(options.isSending ? { isSending: false } : {})
  });
}

function applyTurnRestart(
  state: ConversationDocument,
  extra: DocumentPatch,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  return withPatch(
    clearStream(
      withPatch(state, {
        restartBaselineMessageIds: new Set(state.messages.map((message) => message.id))
      }),
      effects,
      { hasReceivedFirstToken: true, resetThinking: true, isStopPending: true, compaction: true }
    ),
    { isSending: true, ...extra }
  );
}

function applyTurnRestartResult(
  state: ConversationDocument,
  event: Extract<ConversationDocumentEvent, { type: "turn_restart_succeeded" }>,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  let next = state;

  if (event.messages) {
    const snapshot = sanitizeMessages(event.messages);
    const snapshotIds = new Set(snapshot.map((message) => message.id));
    const baseline = state.restartBaselineMessageIds ?? new Set<string>();
    next = withPatch(next, {
      messages: [
        ...snapshot,
        ...state.messages.filter(
          (message) => !baseline.has(message.id) && !snapshotIds.has(message.id)
        )
      ]
    });
  }

  if (event.conversation) {
    next = withPatch(next, {
      title: event.conversation.title,
      titleGenerationStatus: event.conversation.titleGenerationStatus
    });
  }

  if (event.active) {
    effects.push({ kind: "conversation_activity_broadcast", isActive: true });
    next = withPatch(next, { isActive: true });
  }

  if (event.sending) {
    next = withPatch(next, { isSending: true });
  }

  return next;
}

function applySubmissionStarted(
  state: ConversationDocument,
  content: string,
  attachments: MessageAttachment[],
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  const timestamp = new Date(now()).toISOString();
  const optimisticUserMessage: Message = {
    id: `local_${now()}`,
    conversationId: state.conversationId,
    role: "user",
    content,
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0,
    systemKind: null,
    compactedAt: null,
    createdAt: timestamp,
    attachments
  };

  return withPatch(
    clearStream(state, effects, { hasReceivedFirstToken: true, resetThinking: true }),
    {
      finalizePending: false,
      isSending: true,
      isActive: true,
      messages: [...state.messages, optimisticUserMessage],
      pendingLocalSubmissions: [
        ...state.pendingLocalSubmissions,
        {
          localMessageId: optimisticUserMessage.id,
          content,
          attachments,
          serverMessageId: null
        }
      ],
      pendingAnchorMessageId: optimisticUserMessage.id
    }
  );
}

function applyTransportFailed(
  state: ConversationDocument,
  errorMessage: string,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  const restored = restorePendingSubmissions(state, effects);
  effects.push({ kind: "error_shown", message: errorMessage });
  return withPatch(restored, { isSending: false });
}

function restorePendingSubmissions(
  state: ConversationDocument,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  if (state.pendingLocalSubmissions.length === 0) {
    return state;
  }

  const failedIds = new Set(
    state.pendingLocalSubmissions.map((submission) => submission.localMessageId)
  );
  const latestSubmission =
    state.pendingLocalSubmissions[state.pendingLocalSubmissions.length - 1];

  effects.push({ kind: "composer_restored", submission: latestSubmission });

  return withPatch(state, {
    messages: state.messages.filter((message) => !failedIds.has(message.id)),
    pendingLocalSubmissions: []
  });
}


function applyTitleSync(
  state: ConversationDocument,
  conversation: Conversation,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  if (state.title !== conversation.title) {
    effects.push({ kind: "conversation_title_broadcast", title: conversation.title });
  }

  if (
    conversation.titleGenerationStatus === "completed" ||
    conversation.titleGenerationStatus === "failed"
  ) {
    effects.push({ kind: "title_polling_stopped", haltsPollLoop: true });
  }

  return withPatch(state, {
    title: conversation.title,
    titleGenerationStatus: conversation.titleGenerationStatus
  });
}

function applyConversationSync(
  state: ConversationDocument,
  conversation: Conversation,
  messages: Message[],
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  const activeStreamMessageId = state.streamMessageId;
  const hasLocalStreamState =
    Boolean(activeStreamMessageId) ||
    Boolean(state.streamThinkingTarget) ||
    Boolean(state.streamAnswerTarget) ||
    state.streamTimeline.length > 0;

  const reconciliation = reconcileSnapshotMessages(
    state.messages,
    messages,
    activeStreamMessageId,
    state.pendingLocalSubmissions
  );

  let next = withPatch(state, {
    messages: reconciliation.messages,
    pendingLocalSubmissions: reconciliation.pendingLocalSubmissions,
    renderKeyByMessageId: mergeRenderKeyRemaps(
      state.renderKeyByMessageId,
      reconciliation.anchorMessageIdRemap
    ),
    pendingAnchorMessageId: remapAnchorMessageId(
      state.pendingAnchorMessageId,
      reconciliation.anchorMessageIdRemap
    ),
    title: conversation.title,
    titleGenerationStatus: conversation.titleGenerationStatus
  });

  const activeMessage = activeStreamMessageId
    ? messages.find((message) => message.id === activeStreamMessageId)
    : null;

  if (activeMessage?.status === "streaming") {
    next = syncActiveStreamingMessage(next, activeMessage, false, now, effects);
  } else if (!activeStreamMessageId) {
    const streamingMessage = messages.find(
      (message) => message.role === "assistant" && message.status === "streaming"
    );
    if (streamingMessage) {
      next = syncActiveStreamingMessage(next, streamingMessage, !hasLocalStreamState, now, effects);
    }
  }

  const shouldIgnoreInactiveResult =
    !conversation.isActive &&
    hasLocalStreamState &&
    (!activeMessage || activeMessage.status === "streaming");

  if (shouldIgnoreInactiveResult) {
    return next;
  }

  const awaitingTurnStart = state.isSending && !activeStreamMessageId;
  if (
    !awaitingTurnStart &&
    !state.finalizePending &&
    (!conversation.isActive || (activeMessage && activeMessage.status !== "streaming"))
  ) {
    if (activeMessage && activeMessage.status !== "streaming") {
      next = withPatch(next, {
        messages: next.messages.map((m) => (m.id === activeMessage.id ? activeMessage : m))
      });
    }
    next = clearStream(next, effects, { hasReceivedFirstToken: true, isSending: true });
    if (!conversation.isActive) {
      next = withPatch(next, { isActive: false });
    }
    effects.push({ kind: "message_sync_stopped" });
    return next;
  }

  return next;
}

function syncActiveStreamingMessage(
  state: ConversationDocument,
  snapshotMessage: Message,
  adopt: boolean,
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  if (state.finishedStreamMessageIds.has(snapshotMessage.id)) {
    return state;
  }
  const adoptedStream = adoptStreamingSnapshotState(snapshotMessage.timeline);
  const nextAnswer =
    state.streamAnswerTarget.length >= adoptedStream.answer.length
      ? state.streamAnswerTarget
      : adoptedStream.answer;
  const nextThinkingCandidate = snapshotMessage.thinkingContent ?? "";
  const nextThinking =
    state.streamThinkingTarget.length >= nextThinkingCandidate.length
      ? state.streamThinkingTarget
      : nextThinkingCandidate;
  const mergedTimeline = adopt
    ? adoptedStream.timeline
    : mergeStreamingSnapshotTimeline(state.streamTimeline, adoptedStream.timeline);
  const nextTimeline =
    mergedTimeline.at(-1)?.timelineKind === "action"
      ? completeStreamingThinkingPhase(
          mergedTimeline,
          nextThinking.length,
          "completed",
          new Date(now()).toISOString()
        )
      : mergedTimeline;

  effects.push({ kind: "stream_buffer_set_answer", text: nextAnswer, immediate: adopt });
  effects.push({ kind: "stream_buffer_set_thinking", text: nextThinking, immediate: adopt });

  return withPatch(state, {
    streamMessageId: snapshotMessage.id,
    streamAnswerTarget: nextAnswer,
    streamThinkingTarget: nextThinking,
    streamTimeline: nextTimeline,
    hasReceivedFirstToken: Boolean(nextAnswer || nextThinking || nextTimeline.length),
    isSending: true,
    isActive: true
  });
}

function mergeRenderKeyRemaps(
  renderKeyByMessageId: ReadonlyMap<string, string>,
  remap: Map<string, string>
): ReadonlyMap<string, string> {
  if (remap.size === 0) {
    return renderKeyByMessageId;
  }
  const next = new Map(renderKeyByMessageId);
  for (const [localId, serverId] of remap.entries()) {
    next.set(serverId, next.get(localId) ?? localId);
  }
  return next;
}

function remapAnchorMessageId(
  pendingAnchorMessageId: string | null,
  remap: Map<string, string>
): string | null {
  if (!pendingAnchorMessageId) {
    return pendingAnchorMessageId;
  }
  return remap.get(pendingAnchorMessageId) ?? pendingAnchorMessageId;
}

function applyServerMessage(
  state: ConversationDocument,
  message: ServerMessage,
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  switch (message.type) {
    case "ready": {
      const isActive = message.activeConversations.some(
        (conversation) =>
          conversation.id === state.conversationId &&
          conversation.status === "streaming"
      );
      effects.push({ kind: "conversation_activity_broadcast", isActive });
      return withPatch(state, { isActive });
    }
    case "snapshot": {
      if (message.conversationId !== state.conversationId) {
        return state;
      }
      const snapshotMessages = message.messages as Message[];
      let next = withPatch(state, {
        queuedMessages: (message.queuedMessages as QueuedMessage[] | undefined) ?? [],
        isActive: snapshotMessages.some(
          (snapshotMessage) =>
            snapshotMessage.role === "assistant" && snapshotMessage.status === "streaming"
        )
      });
      let activeStreamMessageId = state.streamMessageId;
      if (activeStreamMessageId) {
        const activeSnapshotMessage = snapshotMessages.find(
          (snapshotMessage) => snapshotMessage.id === activeStreamMessageId
        );

        if (activeSnapshotMessage?.status === "streaming") {
          next = syncActiveStreamingMessage(next, activeSnapshotMessage, false, now, effects);
        } else if ((activeSnapshotMessage || snapshotMessages.length > 0) && !state.finalizePending) {
          const endedStreamMessageId = activeStreamMessageId;
          next = clearStream(next, effects, { hasReceivedFirstToken: true, isSending: true });
          if (!activeSnapshotMessage) {
            next = withPatch(next, {
              messages: next.messages.filter(
                (snapshotMessage2) => snapshotMessage2.id !== endedStreamMessageId
              )
            });
          }
          activeStreamMessageId = null;
        }
      }
      if (!activeStreamMessageId) {
        const streamingMessage = snapshotMessages.find(
          (snapshotMessage) =>
            snapshotMessage.status === "streaming" && snapshotMessage.role === "assistant"
        );
        if (streamingMessage) {
          const adoptedStream = adoptStreamingSnapshotState(streamingMessage.timeline);
          effects.push({ kind: "stream_buffer_set_answer", text: adoptedStream.answer, immediate: true });
          effects.push({
            kind: "stream_buffer_set_thinking",
            text: streamingMessage.thinkingContent ?? "",
            immediate: true
          });
          next = withPatch(next, {
            streamMessageId: streamingMessage.id,
            streamAnswerTarget: adoptedStream.answer,
            streamThinkingTarget: streamingMessage.thinkingContent ?? "",
            streamTimeline: adoptedStream.timeline,
            hasReceivedFirstToken: Boolean(
              adoptedStream.answer || streamingMessage.thinkingContent
            ),
            isSending: true
          });
        }
      }

      const reconciliation = reconcileSnapshotMessages(
        next.messages,
        snapshotMessages,
        activeStreamMessageId,
        next.pendingLocalSubmissions
      );
      return withPatch(next, {
        messages: reconciliation.messages,
        pendingLocalSubmissions: reconciliation.pendingLocalSubmissions,
        renderKeyByMessageId: mergeRenderKeyRemaps(
          next.renderKeyByMessageId,
          reconciliation.anchorMessageIdRemap
        ),
        pendingAnchorMessageId: remapAnchorMessageId(
          next.pendingAnchorMessageId,
          reconciliation.anchorMessageIdRemap
        )
      });
    }
    case "user_message_persisted": {
      if (message.conversationId !== state.conversationId) {
        return state;
      }
      const serverMessage = sanitizeMessages([message.message as Message])[0];
      if (!serverMessage) {
        return state;
      }
      const submission = state.pendingLocalSubmissions.find(
        (candidate) =>
          candidate.serverMessageId === null &&
          matchesPendingLocalSubmission(serverMessage, candidate)
      );
      let renderKeyByMessageId = state.renderKeyByMessageId;
      let pendingAnchorMessageId = state.pendingAnchorMessageId;
      let pendingLocalSubmissions = state.pendingLocalSubmissions;
      if (submission) {
        const nextRenderKeys = new Map(renderKeyByMessageId);
        nextRenderKeys.set(
          serverMessage.id,
          nextRenderKeys.get(submission.localMessageId) ?? submission.localMessageId
        );
        renderKeyByMessageId = nextRenderKeys;
        if (pendingAnchorMessageId === submission.localMessageId) {
          pendingAnchorMessageId = serverMessage.id;
        }
        pendingLocalSubmissions = pendingLocalSubmissions.filter(
          (candidate) => candidate.localMessageId !== submission.localMessageId
        );
      }
      const messages = state.messages.some((m) => m.id === serverMessage.id)
        ? state.messages
        : submission && state.messages.some((m) => m.id === submission.localMessageId)
          ? state.messages.map((m) => (m.id === submission.localMessageId ? serverMessage : m))
          : [...state.messages, serverMessage];
      return withPatch(state, {
        messages,
        pendingLocalSubmissions,
        renderKeyByMessageId,
        pendingAnchorMessageId
      });
    }
    case "queue_updated":
      if (message.conversationId !== state.conversationId) {
        return state;
      }
      return withPatch(state, {
        queuedMessages: (message.queuedMessages as QueuedMessage[] | undefined) ?? []
      });
    case "messages_deleted": {
      if (message.conversationId !== state.conversationId) {
        return state;
      }
      const deletedMessageIds = new Set(message.messageIds);
      return withPatch(state, {
        messages: state.messages.filter((message2) => !deletedMessageIds.has(message2.id))
      });
    }
    case "conversation_cleared": {
      if (message.conversationId !== state.conversationId) {
        return state;
      }
      effects.push({ kind: "token_usage_stored", tokens: null });
      effects.push({ kind: "error_cleared" });
      effects.push({ kind: "conversation_activity_broadcast", isActive: false });
      const next = clearStream(state, effects, {
        hasReceivedFirstToken: true,
        resetThinking: true,
        isStopPending: true,
        compaction: true,
        isSending: true
      });
      return withPatch(next, {
        messages: [],
        queuedMessages: [],
        isActive: false,
        usedTokens: null
      });
    }
    case "error": {
      if (isQueuedMessageOperationError(message.message)) {
        effects.push({ kind: "error_shown", message: message.message });
        return state;
      }

      effects.push({ kind: "conversation_activity_broadcast", isActive: false });
      let next = withPatch(state, { compactionInProgress: false, isActive: false });
      const activeStreamMessageId = state.streamMessageId;
      next = withPatch(next, {
        streamTimeline: completeStreamingThinkingPhase(
          next.streamTimeline,
          state.streamThinkingTarget.length,
          "error",
          new Date(now()).toISOString()
        )
      });
      const finalTimeline = next.streamTimeline;
      if (activeStreamMessageId) {
        next = withPatch(next, {
          messages: next.messages.map((m) =>
            m.id === activeStreamMessageId
              ? { ...m, status: "error" as const, content: message.message, timeline: finalTimeline }
              : m
          )
        });
        effects.push({ kind: "error_cleared" });
      } else {
        next = restorePendingSubmissions(next, effects);
        effects.push({ kind: "error_shown", message: message.message });
      }
      next = clearStream(next, effects, { isSending: true });
      return withPatch(next, { finalizePending: false });
    }
    case "delta": {
      if (message.conversationId !== state.conversationId) {
        return state;
      }
      return applyStreamEvent(state, message.event, now, effects);
    }
    case "conversation_title_updated": {
      if (message.conversationId !== state.conversationId) {
        return state;
      }
      effects.push({ kind: "conversation_title_broadcast", title: message.title });
      effects.push({ kind: "title_polling_stopped", haltsPollLoop: false });
      return withPatch(state, { title: message.title, titleGenerationStatus: "completed" });
    }
    default:
      return state;
  }
}

function applyStreamEvent(
  state: ConversationDocument,
  event: ChatStreamEvent,
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  if (event.type === "compaction_start") {
    return withPatch(state, { compactionInProgress: true });
  }

  if (event.type === "compaction_end") {
    return withPatch(state, { compactionInProgress: false });
  }

  if (event.type === "stream_retry") {
    effects.push({ kind: "stream_buffer_reset" });
    return withPatch(state, {
      finalizePending: false,
      streamTimeline: [],
      streamAnswerTarget: "",
      streamThinkingTarget: ""
    });
  }

  if (event.type === "message_start") {
    effects.push({ kind: "rewind_cancelled", reason: REWIND_CANCEL_REASON });
    effects.push({ kind: "stream_buffer_reset" });
    effects.push({ kind: "conversation_activity_broadcast", isActive: true });
    const finishedStreamMessageIds = new Set(state.finishedStreamMessageIds);
    finishedStreamMessageIds.delete(event.messageId);
    const next = withPatch(state, {
      finishedStreamMessageIds,
      isActive: true,
      streamMessageId: event.messageId,
      hasReceivedFirstToken: false,
      finalizePending: false,
      streamTimeline: [],
      streamAnswerTarget: "",
      streamThinkingTarget: ""
    });
    return withPatch(next, {
      messages: next.messages.some((message) => message.id === event.messageId)
        ? next.messages
        : [
            ...next.messages,
            {
              id: event.messageId,
              conversationId: state.conversationId,
              role: "assistant",
              content: "",
              thinkingContent: "",
              status: "streaming",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date(now()).toISOString()
            }
          ]
    });
  }

  if (event.type === "context_usage") {
    effects.push({ kind: "token_usage_stored", tokens: event.contextTokens });
    return withPatch(state, {
      usedTokens: event.contextTokens,
      compactionLimit: event.compactionLimit,
      memoryUsage:
        typeof event.memoriesUsed === "number" && typeof event.memoriesTotal === "number"
          ? { used: event.memoriesUsed, total: event.memoriesTotal }
          : state.memoryUsage
    });
  }

  if (event.type === "thinking_delta") {
    const next = withPatch(state, {
      compactionInProgress: false,
      hasReceivedFirstToken: true,
      streamTimeline: ensureStreamingThinkingPhase(
        state.streamTimeline,
        state.streamMessageId ?? "streaming",
        state.streamThinkingTarget.length,
        new Date(now()).toISOString()
      ),
      streamThinkingTarget: state.streamThinkingTarget + event.text,
      thinkingStartedAt: state.thinkingStartedAt ?? now()
    });
    effects.push({ kind: "stream_buffer_append_thinking", text: event.text });
    return next;
  }

  if (event.type === "answer_delta") {
    const next = withPatch(state, {
      compactionInProgress: false,
      hasReceivedFirstToken: true,
      streamTimeline: completeStreamingThinkingPhase(
        state.streamTimeline,
        state.streamThinkingTarget.length,
        "completed",
        new Date(now()).toISOString()
      ),
      streamAnswerTarget: state.streamAnswerTarget + event.text,
      thinkingDuration:
        state.thinkingStartedAt !== null
          ? state.thinkingDuration ?? (now() - state.thinkingStartedAt) / 1000
          : state.thinkingDuration
    });
    effects.push({ kind: "stream_buffer_append_answer", text: event.text });
    return next;
  }

  if (event.type === "answer_reset") {
    effects.push({ kind: "stream_buffer_set_answer", text: "", immediate: true });
    return withPatch(state, { streamAnswerTarget: "" });
  }

  if (event.type === "system_notice") {
    return withPatch(state, {
      messages: [
        ...state.messages,
        {
          id: `ws_notice_${now()}`,
          conversationId: state.conversationId,
          role: "system",
          content: event.text,
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 0,
          systemKind: event.kind,
          compactedAt: null,
          createdAt: new Date(now()).toISOString()
        }
      ]
    });
  }

  if (event.type === "action_start") {
    const timelineWithCompletedThinking = completeStreamingThinkingPhase(
      state.streamTimeline,
      state.streamThinkingTarget.length,
      "completed",
      new Date(now()).toISOString()
    );
    const isExisting = timelineWithCompletedThinking.some(
      (item) => item.timelineKind === "action" && item.id === event.action.id
    );
    if (isExisting) {
      return withPatch(state, {
        compactionInProgress: false,
        streamTimeline: appendStreamingAction(timelineWithCompletedThinking, event.action)
      });
    }

    const previousTextLen = timelineWithCompletedThinking
      .filter((item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> => item.timelineKind === "text")
      .reduce((sum, item) => sum + item.content.length, 0);

    const newText = state.streamAnswerTarget.slice(previousTextLen);
    const nextTimeline = [...timelineWithCompletedThinking];

    if (newText.length > 0) {
      nextTimeline.push({
        id: `stream_text_${now()}_${state.streamTimeline.length}`,
        timelineKind: "text",
        sortOrder: nextTimeline.length,
        createdAt: new Date(now()).toISOString(),
        content: newText
      });
    }

    return withPatch(state, {
      compactionInProgress: false,
      streamTimeline: appendStreamingAction(nextTimeline, event.action)
    });
  }

  if (event.type === "action_complete" || event.type === "action_error") {
    return withPatch(state, {
      compactionInProgress: false,
      messages: replaceMessageAction(state.messages, event.action),
      streamTimeline: updateStreamingAction(
        completeStreamingThinkingPhase(
          state.streamTimeline,
          state.streamThinkingTarget.length,
          "completed",
          new Date(now()).toISOString()
        ),
        event.action
      )
    });
  }

  if (event.type === "done") {
    return applyStreamDone(state, event, now, effects);
  }

  if (event.type === "error") {
    return applyStreamError(state, event, now, effects);
  }

  return state;
}

function applyStreamDone(
  state: ConversationDocument,
  event: Extract<ChatStreamEvent, { type: "done" }>,
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  const finishedStreamMessageIds = new Set(state.finishedStreamMessageIds);
  finishedStreamMessageIds.add(event.messageId);
  const wasStopped = state.isStopPending;

  const completedTimeline = completeStreamingThinkingPhase(
    state.streamTimeline,
    state.streamThinkingTarget.length,
    wasStopped ? "stopped" : "completed",
    new Date(now()).toISOString()
  );

  const isForActiveStream = event.messageId === state.streamMessageId;

  let next = withPatch(state, {
    finishedStreamMessageIds,
    compactionInProgress: false,
    isStopPending: false,
    streamTimeline: completedTimeline
  });

  if (isForActiveStream) {
    effects.push({ kind: "conversation_activity_broadcast", isActive: false });
    next = withPatch(next, { isActive: false });
  }

  const serverTimeline = event.message?.timeline ?? [];
  const finalTimeline = serverTimeline.length > 0 ? serverTimeline : completedTimeline;

  const completedMessage = event.message;

  if (completedMessage) {
    const completedWithTimeline = {
      ...completedMessage,
      status: wasStopped ? ("stopped" as const) : ("completed" as const),
      timeline: finalTimeline
    } as Message;
    next = withPatch(next, {
      messages: next.messages.some((m) => m.id === event.messageId)
        ? next.messages.map((m) => (m.id === event.messageId ? completedWithTimeline : m))
        : [...next.messages, completedWithTimeline]
    });
  } else if (isForActiveStream) {
    next = withPatch(next, {
      messages: next.messages.map((m) =>
        m.id === event.messageId
          ? {
              ...m,
              content: state.streamAnswerTarget,
              thinkingContent: state.streamThinkingTarget,
              status: wasStopped ? ("stopped" as const) : ("completed" as const),
              timeline: finalTimeline
            }
          : m
      )
    });
  }

  if (!wasStopped) {
    next = withPatch(next, {
      messages: next.messages.filter(
        (m) =>
          !(
            m.role === "assistant" &&
            m.status === "error" &&
            (m.timeline ?? []).length === 0 &&
            !m.thinkingContent?.trim()
          )
      )
    });
  }

  if (isForActiveStream) {
    next = withPatch(next, { isSending: false });
    if (wasStopped) {
      next = clearStream(withPatch(next, { finalizePending: false }), effects, {});
    } else {
      next = withPatch(next, { finalizePending: true });
      effects.push({ kind: "stream_buffer_finalize" });
      effects.push({ kind: "stream_buffer_drain_awaited" });
    }
  }

  return next;
}

function applyStreamError(
  state: ConversationDocument,
  event: Extract<ChatStreamEvent, { type: "error" }>,
  now: () => number,
  effects: ConversationDocumentEffect[]
): ConversationDocument {
  const activeStreamMessageId = state.streamMessageId;
  const completedTimeline = completeStreamingThinkingPhase(
    state.streamTimeline,
    state.streamThinkingTarget.length,
    "error",
    new Date(now()).toISOString()
  );

  let next = withPatch(state, {
    compactionInProgress: false,
    isStopPending: false,
    streamTimeline: completedTimeline
  });

  if (activeStreamMessageId) {
    effects.push({ kind: "conversation_activity_broadcast", isActive: false });
    next = withPatch(next, {
      isActive: false,
      messages: next.messages.map((m) =>
        m.id === activeStreamMessageId
          ? { ...m, status: "error" as const, content: event.message, timeline: completedTimeline }
          : m
      )
    });
    next = clearStream(withPatch(next, { finalizePending: false }), effects, { isSending: true });
  }

  effects.push({ kind: "error_cleared" });
  return next;
}

export function selectRenderableMessages(
  document: ConversationDocument,
  removedMessageIds: ReadonlySet<string>
): Message[] {
  const pendingById = new Map(
    document.pendingLocalSubmissions.map((submission) => [
      submission.localMessageId,
      submission
    ] as const)
  );
  const serverUserSignatures = new Set(
    document.messages
      .filter((message) => !message.id.startsWith("local_") && message.role === "user")
      .map(
        (message) =>
          `${message.content} ${getAttachmentIdSignature(message.attachments)}`
      )
  );

  return document.messages.filter((message) => {
    if (removedMessageIds.has(message.id)) {
      return false;
    }

    if (!message.id.startsWith("local_")) {
      return true;
    }

    const pendingSubmission = pendingById.get(message.id);

    if (pendingSubmission) {
      return pendingSubmission.serverMessageId === null;
    }

    if (message.role !== "user") {
      return true;
    }

    return !serverUserSignatures.has(
      `${message.content} ${getAttachmentIdSignature(message.attachments)}`
    );
  });
}

export function selectHasActiveTurn(document: ConversationDocument) {
  return (
    document.isActive ||
    Boolean(document.streamMessageId && !document.finalizePending) ||
    document.messages.some(
      (message) => message.role === "assistant" && message.status === "streaming"
    )
  );
}

export function selectNeedsMessageSync(document: ConversationDocument) {
  return (
    document.isSending ||
    document.pendingLocalSubmissions.length > 0 ||
    document.streamMessageId !== null ||
    document.messages.some(
      (message) => message.role === "assistant" && message.status === "streaming"
    ) ||
    document.messages.some(
      (message) =>
        message.role === "assistant" &&
        !message.content &&
        !(message.timeline?.length ?? 0) &&
        (message.status === "streaming" || message.status === "completed")
    )
  );
}

export function selectRedirectingIds(
  document: ConversationDocument,
  redirectsWhileBusy: boolean
): ReadonlySet<string> {
  return new Set(
    document.queuedMessages
      .filter(
        (item) =>
          item.status === "pending" &&
          (redirectsWhileBusy || document.sendNowIds.has(item.id))
      )
      .map((item) => item.id)
  );
}
