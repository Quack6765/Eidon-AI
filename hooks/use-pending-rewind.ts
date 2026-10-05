"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { describeRewind, planConversationRewind } from "@/lib/conversation-rewind";
import type { ComposerDraft, Conversation, Message, MessageAttachment, QueuedMessage } from "@/lib/types";
import { useStableHandler } from "@/lib/use-stable-handler";

export const REWIND_UNDO_WINDOW_MS = 6000;

export type RewindResult = {
  conversation: Conversation;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  draft: ComposerDraft | null;
};

type PendingRewind = {
  messageId: string;
  removedMessageIds: Set<string>;
  composerBefore: { input: string; attachments: MessageAttachment[] } | null;
  prefilledInput: string | null;
};

type ComposerAccess = {
  getInput: () => string;
  setInput: (value: string) => void;
  getAttachments: () => MessageAttachment[];
  setAttachments: (attachments: MessageAttachment[]) => void;
};

const NO_REMOVED_MESSAGES = new Set<string>();

function rewindUrl(messageId: string) {
  return `/api/messages/${messageId}/rewind`;
}

async function readRewindError(response: Response) {
  try {
    return ((await response.json()) as { error?: string }).error ?? "Unable to rewind the conversation";
  } catch {
    return "Unable to rewind the conversation";
  }
}

export function usePendingRewind(options: {
  conversationId: string;
  getMessages: () => Message[];
  composer: ComposerAccess;
  onCommitted: (result: RewindResult) => void;
  onError: (message: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [pending, setPending] = useState<PendingRewind | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [undoLabel, setUndoLabel] = useState("");
  const pendingRef = useRef<PendingRewind | null>(null);
  const timerRef = useRef<number | null>(null);
  const commitRef = useRef<Promise<boolean> | null>(null);

  function setPendingRewind(next: PendingRewind | null) {
    pendingRef.current = next;
    setPending(next);
  }

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function restoreComposer(rewind: PendingRewind) {
    if (!rewind.composerBefore) return;
    const { composer } = latest.current;
    if (composer.getInput() === rewind.prefilledInput) {
      composer.setInput(rewind.composerBefore.input);
    }
    composer.setAttachments(rewind.composerBefore.attachments);
  }

  const commit = useStableHandler((): Promise<boolean> => {
    if (commitRef.current) return commitRef.current;
    const rewind = pendingRef.current;
    if (!rewind) return Promise.resolve(true);

    clearTimer();
    setIsCommitting(true);
    const request = (async () => {
      try {
        const response = await fetch(rewindUrl(rewind.messageId), { method: "POST" });
        if (!response.ok) {
          throw new Error(await readRewindError(response));
        }
        const result = (await response.json()) as RewindResult;
        setPendingRewind(null);
        latest.current.onCommitted(result);
        return true;
      } catch (error) {
        setPendingRewind(null);
        restoreComposer(rewind);
        latest.current.onError(error instanceof Error ? error.message : "Unable to rewind the conversation");
        return false;
      } finally {
        commitRef.current = null;
        setIsCommitting(false);
      }
    })();
    commitRef.current = request;
    return request;
  });

  const scheduleCommit = useStableHandler(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void commit();
    }, REWIND_UNDO_WINDOW_MS);
  });

  const start = useStableHandler(async (messageId: string) => {
    const alreadyRemoved = pendingRef.current?.removedMessageIds ?? NO_REMOVED_MESSAGES;
    if ((pendingRef.current || commitRef.current) && !(await commit())) return;

    const { composer, getMessages } = latest.current;
    const plan = planConversationRewind(
      getMessages().filter((message) => !alreadyRemoved.has(message.id)),
      messageId
    );
    if (!plan || plan.removedMessages.length === 0) return;

    let composerBefore: PendingRewind["composerBefore"] = null;
    let prefilledInput: string | null = null;
    if (plan.restoresDraft) {
      composerBefore = {
        input: composer.getInput(),
        attachments: composer.getAttachments()
      };
      prefilledInput = plan.message.content;
      composer.setInput(plan.message.content);
      composer.setAttachments(plan.message.attachments ?? []);
    }

    setPendingRewind({
      messageId,
      removedMessageIds: new Set(plan.removedMessages.map((message) => message.id)),
      composerBefore,
      prefilledInput
    });
    setUndoLabel(describeRewind(plan.removedMessages.length));
    scheduleCommit();
  });

  const undo = useStableHandler(() => {
    const rewind = pendingRef.current;
    if (!rewind || commitRef.current) return;
    clearTimer();
    setPendingRewind(null);
    restoreComposer(rewind);
  });

  const cancel = useStableHandler((reason: string) => {
    if (!pendingRef.current || commitRef.current) return;
    undo();
    latest.current.onError(reason);
  });

  const hold = useStableHandler((held: boolean) => {
    if (!pendingRef.current || commitRef.current) return;
    if (held) {
      clearTimer();
    } else {
      scheduleCommit();
    }
  });

  const { conversationId } = options;
  useEffect(() => () => undo(), [conversationId, undo]);

  const removedMessageIds = pending?.removedMessageIds ?? NO_REMOVED_MESSAGES;

  return useMemo(() => ({
    pendingRewind: pending,
    removedMessageIds,
    isUndoVisible: pending !== null && !isCommitting,
    undoLabel,
    start,
    undo,
    commit,
    cancel,
    hold
  }), [cancel, commit, hold, isCommitting, pending, removedMessageIds, start, undo, undoLabel]);
}
