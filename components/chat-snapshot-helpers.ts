import { isFreshImageGenerationRequest } from "@/lib/image-generation/follow-up-context";
import type {
  Message,
  MessageAction,
  MessageAttachment,
  MessageTimelineItem
} from "@/lib/types";

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

export function getActionSignature(action: Pick<MessageAction, "kind" | "label" | "detail" | "toolName">) {
  return [action.kind, action.label, action.detail, action.toolName ?? ""].join("\u0000");
}

export function isLooseImageActionMatch(
  left: Pick<MessageAction, "kind" | "label" | "detail" | "toolName">,
  right: Pick<MessageAction, "kind" | "label" | "detail" | "toolName">
) {
  return (
    left.kind === "image_generation" &&
    right.kind === "image_generation" &&
    left.label === right.label &&
    (left.toolName ?? "") === (right.toolName ?? "") &&
    (!left.detail || !right.detail)
  );
}

export function getAttachmentIdSignature(attachments: MessageAttachment[] | undefined) {
  return [...(attachments ?? []).map((attachment) => attachment.id)].sort().join("\u0000");
}

export function getLatestUserMessageContent(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }

  return "";
}

function hasPriorAssistantImageContext(messages: Message[]) {
  const latestUserIndex = [...messages].map((message) => message.role).lastIndexOf("user");

  if (latestUserIndex <= 0) {
    return false;
  }

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    if (message.attachments?.some((attachment) => attachment.kind === "image")) {
      return true;
    }

    if (/\b(generated|created|made|rendered)\b[\s\S]{0,40}\b(image|images|picture|pictures|photo|photos|render|renders)\b/i.test(message.content)) {
      return true;
    }
  }

  return false;
}

export function shouldShowProvisionalImageAction(messages: Message[]) {
  const latestUserContent = getLatestUserMessageContent(messages);

  if (!latestUserContent) {
    return false;
  }

  return isFreshImageGenerationRequest(
    latestUserContent,
    hasPriorAssistantImageContext(messages)
  );
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

export function findMatchingActionIndex(timeline: MessageTimelineItem[], action: MessageAction) {
  const signature = getActionSignature(action);

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];

    if (item.timelineKind === "action") {
      if (getActionSignature(item) === signature || isLooseImageActionMatch(item, action)) {
        return index;
      }
    }
  }

  return -1;
}

export function appendStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  const existingIndex = timeline.findIndex(
    (item) => item.timelineKind === "action" && item.id === action.id
  );

  if (existingIndex !== -1) {
    return timeline.map((item, index) =>
      index === existingIndex ? { ...action, timelineKind: "action" } : item
    );
  }

  const matchingIndex = findMatchingActionIndex(timeline, action);

  if (matchingIndex !== -1) {
    return timeline.map((item, index) =>
      index === matchingIndex ? { ...action, timelineKind: "action" } : item
    );
  }

  return [...timeline, { ...action, timelineKind: "action" }];
}

export function updateStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  let found = false;
  const nextTimeline = timeline.map((item): MessageTimelineItem => {
    if (item.timelineKind === "action" && item.id === action.id) {
      found = true;
      return { ...action, timelineKind: "action" };
    }

    return item;
  });

  if (found) {
    return nextTimeline;
  }

  const matchingIndex = findMatchingActionIndex(timeline, action);

  if (matchingIndex !== -1) {
    return timeline.map((item, index) =>
      index === matchingIndex ? { ...action, timelineKind: "action" } : item
    );
  }

  return [...timeline, { ...action, timelineKind: "action" }];
}

export function isLegacyCompactionNotice(message: Pick<Message, "role" | "systemKind">) {
  return message.role === "system" && message.systemKind === "compaction_notice";
}

export function sanitizeMessages(messages: Message[] | undefined) {
  if (!messages) return [];
  return messages.filter((message) => !isLegacyCompactionNotice(message));
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

  const merged = sanitizedSnapshot.map((snapshotMsg) => {
    const currentMsg = current.find((m) => m.id === snapshotMsg.id);

    if (currentMsg && currentMsg.id === activeStreamMessageId) {
      return currentMsg;
    }

    if (currentMsg && currentMsg.status === "completed" && snapshotMsg.status === "streaming") {
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

  return {
    messages: [...merged, ...pendingLocalMessages],
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
    consolidated.push({
      ...item,
      timelineKind: "action",
      sortOrder: consolidated.length
    });
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
