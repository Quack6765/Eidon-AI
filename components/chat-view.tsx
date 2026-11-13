"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Conversation as ConversationContainer,
  ConversationContent,
  ConversationScrollButton
} from "@/components/ai-elements/conversation";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useRouter } from "next/navigation";
import { Plus, Share2 } from "lucide-react";

import { maybeNotifyTurnReady } from "@/lib/chat-turn-ping";

import {
  AttachmentPreviewModal,
  useAttachmentPreviewController
} from "@/components/attachment-preview-modal";
import {
  applyConversationDocumentEvent,
  createConversationDocument,
  selectHasActiveTurn,
  selectNeedsMessageSync,
  selectRedirectingIds,
  selectRenderableMessages,
  type ConversationDocument,
  type ConversationDocumentEffect,
  type ConversationDocumentEvent
} from "@/components/conversation-document";
import { ChatComposer } from "@/components/chat-composer";
import { FileDropOverlay } from "@/components/file-drop-overlay";
import { QueuedMessageBanner } from "@/components/queued-message-banner";
import { useShareConversation } from "@/components/share-conversation-context";
import { useComposerSpeech } from "@/hooks/use-composer-speech";
import { useFileDrop } from "@/hooks/use-file-drop";
import { usePendingAttachments } from "@/hooks/use-pending-attachments";
import { usePersonas } from "@/hooks/use-personas";
import { useComposerReferences } from "@/hooks/use-composer-references";
import {
  clearChatBootstrap,
  consumeComposerDraft,
  readChatBootstrap,
  storeComposerDraft,
  type ChatBootstrapPayload
} from "@/lib/chat-bootstrap";
import { ResearchPlanCard } from "@/components/research-plan-card";
import { useResearchPlanDraft } from "@/hooks/use-research-plan-draft";
import { createStreamBuffer } from "@/lib/stream-buffer";
import { toReferenceCandidates } from "@/lib/reference-tokens";
import { StreamingMessage } from "@/components/streaming-message";
import { useStableHandler } from "@/lib/use-stable-handler";
import { usePendingRewind } from "@/hooks/use-pending-rewind";
import { Toast } from "@/components/ui/toast";
import { IOS_PWA_CONVERSATION_VIEWPORT_EVENT } from "@/lib/use-ios-pwa";
import { useContextTokens } from "@/lib/context-tokens-context";
import {
  dispatchConversationActivityUpdated,
  dispatchConversationTitleUpdated
} from "@/lib/conversation-events";
import { useWebSocket } from "@/lib/ws-client";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { isScrolledToBottom, shouldAutofocusTextInput } from "@/lib/utils";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import { matchDelegationReplies } from "@/lib/delegation-marker";
import type { AutomationProposalOverrides } from "@/lib/automation-proposals";
import type {
  ChatResearchOptions,
  ComposerDraft,
  Conversation,
  MemoryCategory,
  Message,
  MessageAction,
  MessageAttachment,
  MessageTimelineItem,
  ProviderProfileSummary,
  ReasoningEffort
} from "@/lib/types";

const INITIAL_VISIBLE_MESSAGE_COUNT = 60;
const VISIBLE_MESSAGE_INCREMENT = 100;
const PINNED_TURN_TOP_INSET_PX = 12;
const EMPTY_TIMELINE: MessageTimelineItem[] = [];
const WS_UNAVAILABLE_MESSAGE =
  "Realtime chat connection is unavailable. Restart Eidon with the websocket server enabled.";

function resolveProviderProfileId(
  conversationProviderId: string | null,
  profiles: ProviderProfileSummary[],
  defaultId: string | null
) {
  const profileIds = new Set(profiles.map((p) => p.id));
  if (conversationProviderId && profileIds.has(conversationProviderId)) {
    return conversationProviderId;
  }
  if (defaultId && profileIds.has(defaultId)) {
    return defaultId;
  }
  return profiles[0]?.id ?? "";
}

function StickToBottomBridge({
  scrollToBottomRef,
  setScrollTargetRef
}: {
  scrollToBottomRef: React.RefObject<(() => void) | null>;
  setScrollTargetRef: React.RefObject<((target: number | null) => void) | null>;
}) {
  const stickToBottom = useStickToBottomContext();
  const { scrollToBottom, stopScroll } = stickToBottom;

  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
    setScrollTargetRef.current = (target) => {
      stickToBottom.targetScrollTop = target === null ? null : () => target;
      if (target !== null) {
        stopScroll();
      }
    };
    return () => {
      scrollToBottomRef.current = null;
      setScrollTargetRef.current = null;
    };
  }, [scrollToBottom, scrollToBottomRef, setScrollTargetRef, stickToBottom, stopScroll]);

  return null;
}

export function ChatView({
  payload,
  retainEmptyConversation = false,
  hideConversationHeader = false
}: {
  payload: ConversationViewPayload;
  retainEmptyConversation?: boolean;
  hideConversationHeader?: boolean;
}) {
  const router = useRouter();
  const retainEmptyConversationRef = useRef(retainEmptyConversation);
  retainEmptyConversationRef.current = retainEmptyConversation;
  const { getTokenUsage, setTokenUsage } = useContextTokens();
  const { canShare, openShareModal } = useShareConversation();
  const previewController = useAttachmentPreviewController();
  const { closeAttachmentPreview } = previewController;
  const redirectsWhileBusy = payload.settings.followUpBehavior === "steer";
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isTemporaryToggled, setIsTemporaryToggled] = useState(payload.conversation.isTemporary);
  const [isResearchToggled, setIsResearchToggled] = useState(false);
  const researchPlan = useResearchPlanDraft();
  const researchUserMessageIdRef = useRef<string | null>(null);
  const streamBufferRef = useRef<ReturnType<typeof createStreamBuffer> | null>(null);
  streamBufferRef.current ??= createStreamBuffer();
  const streamBuffer = streamBufferRef.current;
  const hasInitializedTokensRef = useRef(false);

  const docRef = useRef<ConversationDocument | null>(null);
  if (docRef.current === null) {
    docRef.current = createConversationDocument({
      conversationId: payload.conversation.id,
      messages: payload.messages,
      queuedMessages: payload.queuedMessages,
      title: payload.conversation.title,
      titleGenerationStatus: payload.conversation.titleGenerationStatus,
      isActive: payload.conversation.isActive,
      contextTokens: payload.contextTokens,
      compactionLimit: payload.compactionLimit
    });
  }
  const [doc, setDoc] = useState(docRef.current);

  const [providerProfileId, setProviderProfileId] = useState(
    () => resolveProviderProfileId(
      payload.conversation.providerProfileId,
      payload.providerProfiles,
      payload.defaultProviderProfileId
    )
  );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(
    payload.conversation.reasoningEffort
  );
  const personas = usePersonas();
  const { references: composerReferences, refresh: refreshComposerReferences } = useComposerReferences(
    payload.conversation.id
  );
  const referenceCandidates = useMemo(
    () => toReferenceCandidates(composerReferences),
    [composerReferences]
  );
  const [personaId, setPersonaId] = useState<string | null>(null);
  const {
    pendingAttachments,
    setPendingAttachments,
    isUploadingAttachments,
    uploadFiles,
    removePendingAttachment
  } = usePendingAttachments({
    resolveConversationId: () => payload.conversation.id,
    onError: setError
  });
  const { isDraggingFiles, fileDropProps } = useFileDrop((files) => void uploadFiles(files));
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const setScrollTargetRef = useRef<((target: number | null) => void) | null>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const composerAreaRef = useRef<HTMLDivElement>(null);
  const [composerAreaHeight, setComposerAreaHeight] = useState(160);
  const composerAreaHeightRef = useRef(160);
  const absorbComposerGrowthRef = useRef(false);

  const { speechSnapshot, onStartSpeech, onStopSpeech } = useComposerSpeech({
    selection: payload.settings.speechTranscription,
    cleanupEnabled: payload.settings.speechCleanupEnabled,
    setDraft: setInput,
    clearError: () => setError(""),
    resetKey: payload.conversation.id
  });
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const titlePollTimeoutRef = useRef<number | null>(null);
  const titlePollAttemptsRef = useRef(0);
  const titlePollHaltedRef = useRef(false);
  const messageSyncTimeoutRef = useRef<number | null>(null);
  const messageSyncHaltedRef = useRef(false);
  const initialMessageIdsRef = useRef<Set<string> | null>(null);
  const animatedMessageIdsRef = useRef<Set<string>>(new Set());

  const expandAnchorMessageIdRef = useRef<string | null>(null);
  const earlierMessagesSentinelRef = useRef<HTMLDivElement | null>(null);
  const firstVisibleMessageIdRef = useRef<string | null>(null);
  const bootstrapPayloadRef = useRef<ChatBootstrapPayload | null>(null);
  const bootstrapSubmittedRef = useRef(false);

  const rewind = usePendingRewind({
    conversationId: payload.conversation.id,
    getMessages: () => docRef.current!.messages,
    composer: {
      getInput: () => input,
      setInput,
      getAttachments: () => pendingAttachments,
      setAttachments: setPendingAttachments
    },
    onCommitted: (result) => {
      dispatch({ type: "rewind_committed", messages: result.messages, queuedMessages: result.queuedMessages });
    },
    onError: setError
  });

  function stopTitlePolling() {
    if (titlePollTimeoutRef.current !== null) {
      window.clearTimeout(titlePollTimeoutRef.current);
      titlePollTimeoutRef.current = null;
    }
  }

  function stopMessageSyncPolling() {
    if (messageSyncTimeoutRef.current !== null) {
      window.clearTimeout(messageSyncTimeoutRef.current);
      messageSyncTimeoutRef.current = null;
    }
  }

  function startTitlePolling() {
    if (titlePollTimeoutRef.current !== null || docRef.current!.titleGenerationStatus !== "pending") {
      return;
    }

    titlePollAttemptsRef.current = 0;
    titlePollTimeoutRef.current = window.setTimeout(() => {
      void pollConversationTitle();
    }, 400);
  }

  function runEffects(effects: ConversationDocumentEffect[]) {
    for (const effect of effects) {
      switch (effect.kind) {
        case "stream_buffer_reset":
          streamBuffer.reset();
          break;
        case "stream_buffer_append_thinking":
          streamBuffer.appendThinking(effect.text);
          break;
        case "stream_buffer_append_answer":
          streamBuffer.appendAnswer(effect.text);
          break;
        case "stream_buffer_set_answer":
          streamBuffer.setAnswer(effect.text, { immediate: effect.immediate });
          break;
        case "stream_buffer_set_thinking":
          streamBuffer.setThinking(effect.text, { immediate: effect.immediate });
          break;
        case "stream_buffer_finalize":
          streamBuffer.finalize();
          break;
        case "stream_buffer_drain_awaited":
          streamBuffer.whenDrained(() => dispatch({ type: "stream_drained" }));
          break;
        case "turn_ready_notification":
          void maybeNotifyTurnReady();
          break;
        case "conversation_activity_broadcast":
          dispatchConversationActivityUpdated({
            conversationId: payload.conversation.id,
            isActive: effect.isActive
          });
          break;
        case "conversation_title_broadcast":
          dispatchConversationTitleUpdated({
            conversationId: payload.conversation.id,
            title: effect.title
          });
          break;
        case "token_usage_stored":
          setTokenUsage(payload.conversation.id, effect.tokens);
          break;
        case "composer_restored":
          setInput((current) => current || effect.submission.content || "");
          setPendingAttachments((current) =>
            current.length > 0 ? current : (effect.submission.attachments ?? [])
          );
          break;
        case "error_shown":
          setError(effect.message);
          break;
        case "error_cleared":
          setError("");
          break;
        case "rewind_cancelled":
          rewind.cancel(effect.reason);
          break;
        case "title_polling_stopped":
          stopTitlePolling();
          if (effect.haltsPollLoop) {
            titlePollHaltedRef.current = true;
          }
          break;
        case "message_sync_stopped":
          stopMessageSyncPolling();
          messageSyncHaltedRef.current = true;
          break;
      }
    }
  }

  const runEffectsStable = useStableHandler(runEffects);

  const dispatch = useCallback(
    (event: ConversationDocumentEvent) => {
      const transition = applyConversationDocumentEvent(docRef.current!, event);
      docRef.current = transition.state;
      setDoc(transition.state);
      runEffectsStable(transition.effects);
    },
    [runEffectsStable]
  );

  useEffect(() => {
    if (!hasInitializedTokensRef.current) {
      hasInitializedTokensRef.current = true;
      if (payload.contextTokens === null) {
        const tokens = getTokenUsage(payload.conversation.id);
        if (tokens !== null) {
          dispatch({ type: "payload_changed", usedTokens: tokens });
        }
      }
    }
  }, [payload.conversation.id, payload.contextTokens, getTokenUsage, dispatch]);

  const submitRef = useRef<
    (
      nextInput?: string,
      nextPendingAttachments?: MessageAttachment[],
      nextPersonaId?: string,
      nextResearch?: boolean | ChatResearchOptions
    ) => Promise<void>
  >(async () => {});
  const renderableMessages = useMemo(
    () => selectRenderableMessages(doc, rewind.removedMessageIds),
    [doc, rewind.removedMessageIds]
  );
  const delegationReplies = useMemo(() => matchDelegationReplies(renderableMessages), [renderableMessages]);
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(INITIAL_VISIBLE_MESSAGE_COUNT);
  const hiddenMessageCount = Math.max(renderableMessages.length - visibleMessageLimit, 0);
  const visibleMessages = useMemo(
    () => (hiddenMessageCount > 0 ? renderableMessages.slice(hiddenMessageCount) : renderableMessages),
    [renderableMessages, hiddenMessageCount]
  );
  firstVisibleMessageIdRef.current = visibleMessages[0]?.id ?? null;
  const lastUserMsgIndex = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === "user") return i;
    }
    return -1;
  }, [visibleMessages]);
  const needsMessageSync = useMemo(() => selectNeedsMessageSync(doc), [doc]);
  const redirectingIds = useMemo(
    () => selectRedirectingIds(doc, redirectsWhileBusy),
    [doc, redirectsWhileBusy]
  );

  useEffect(() => {
    if (docRef.current!.conversationId === payload.conversation.id) {
      return;
    }

    dispatch({ type: "payload_changed", conversationId: payload.conversation.id });
    closeAttachmentPreview();
  }, [payload.conversation.id, closeAttachmentPreview, dispatch]);

  useEffect(() => {
    dispatch({ type: "payload_changed", messages: payload.messages });
  }, [payload.messages, dispatch]);

  useEffect(() => {
    dispatch({ type: "payload_changed", queuedMessages: payload.queuedMessages });
  }, [payload.queuedMessages, dispatch]);

  useEffect(() => {
    dispatch({ type: "payload_changed", title: payload.conversation.title });
  }, [payload.conversation.title, dispatch]);

  useEffect(() => {
    dispatch({ type: "payload_changed", isActive: payload.conversation.isActive });
  }, [payload.conversation.isActive, dispatch]);

  useEffect(() => {
    dispatch({ type: "payload_changed", titleGenerationStatus: payload.conversation.titleGenerationStatus });
  }, [payload.conversation.titleGenerationStatus, dispatch]);

  useEffect(() => {
    setProviderProfileId(
      resolveProviderProfileId(
        payload.conversation.providerProfileId,
        payload.providerProfiles,
        payload.defaultProviderProfileId
      )
    );
  }, [payload.conversation.providerProfileId, payload.defaultProviderProfileId, payload.providerProfiles]);

  useEffect(() => {
    setReasoningEffort(payload.conversation.reasoningEffort);
  }, [payload.conversation.id, payload.conversation.reasoningEffort]);

  useEffect(() => {
    contentEndRef.current?.parentElement?.style.removeProperty("min-height");
    setScrollTargetRef.current?.(null);
    scrollToBottomRef.current?.();
  }, [payload.conversation.id]);

  useEffect(() => {
    const preserveKeyboardViewport = (event: Event) => {
      const scrollTop = (event as CustomEvent<number>).detail;
      if (Number.isFinite(scrollTop)) {
        setScrollTargetRef.current?.(scrollTop);
      }
    };

    window.addEventListener(
      IOS_PWA_CONVERSATION_VIEWPORT_EVENT,
      preserveKeyboardViewport,
    );
    return () => {
      window.removeEventListener(
        IOS_PWA_CONVERSATION_VIEWPORT_EVENT,
        preserveKeyboardViewport,
      );
    };
  }, []);

  useLayoutEffect(() => {
    const el = composerAreaRef.current;
    if (!el) return;
    const measure = () => {
      const next = el.offsetHeight;
      if (next === composerAreaHeightRef.current) return;
      const scroller = contentEndRef.current?.closest(".conversation-scroller");
      absorbComposerGrowthRef.current =
        next > composerAreaHeightRef.current &&
        scroller instanceof HTMLElement &&
        isScrolledToBottom(scroller);
      composerAreaHeightRef.current = next;
      setComposerAreaHeight(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!absorbComposerGrowthRef.current) return;
    absorbComposerGrowthRef.current = false;
    const scroller = contentEndRef.current?.closest(".conversation-scroller");
    if (!(scroller instanceof HTMLElement)) return;
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }, [composerAreaHeight]);

  useEffect(() => {
    const anchorMessageId = docRef.current!.pendingAnchorMessageId;
    if (!anchorMessageId) return;
    const exists = visibleMessages.some((m) => m.id === anchorMessageId);
    if (!exists) return;

    requestAnimationFrame(() => {
      const messageId = docRef.current!.pendingAnchorMessageId;
      if (!messageId) return;
      dispatch({ type: "anchor_scrolled" });
      const targetEl =
        document.querySelector(`[data-message-id="${messageId}"]`) ??
        document.querySelector(`[data-message-id="${anchorMessageId}"]`);
      const content = contentEndRef.current?.parentElement;
      const scroller = contentEndRef.current?.closest(".conversation-scroller");
      const behavior =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth";
      if (targetEl && content && scroller) {
        const targetTop = Math.max(
          0,
          scroller.scrollTop +
            targetEl.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            PINNED_TURN_TOP_INSET_PX
        );
        content.style.minHeight = `${targetTop + scroller.clientHeight}px`;
        setScrollTargetRef.current?.(targetTop);
        scroller.scrollTo({ top: targetTop, behavior });
      } else {
        setScrollTargetRef.current?.(scroller?.scrollTop ?? 0);
        targetEl?.scrollIntoView({ block: "start", behavior });
      }
    });
  }, [visibleMessages, dispatch]);

  useEffect(() => {
    if (!expandAnchorMessageIdRef.current) return;
    const messageId = expandAnchorMessageIdRef.current;
    const targetEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!targetEl) return;

    expandAnchorMessageIdRef.current = null;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [visibleMessages]);

  const hasHiddenMessages = hiddenMessageCount > 0;

  useEffect(() => {
    if (!hasHiddenMessages || typeof IntersectionObserver === "undefined") return;
    const sentinel = earlierMessagesSentinelRef.current;
    if (!sentinel) return;
    const scroller = contentEndRef.current?.closest(".conversation-scroller");
    const root = scroller instanceof HTMLElement ? scroller : null;
    let hasScrolled = false;
    const markScrolled = () => {
      hasScrolled = true;
    };
    root?.addEventListener("scroll", markScrolled, { once: true, passive: true });
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (expandAnchorMessageIdRef.current !== null) return;
        if (!hasScrolled) return;
        const rootTop = root?.getBoundingClientRect().top ?? 0;
        if (sentinel.getBoundingClientRect().bottom < rootTop - 600) return;
        expandAnchorMessageIdRef.current = firstVisibleMessageIdRef.current;
        setVisibleMessageLimit((current) => current + VISIBLE_MESSAGE_INCREMENT);
      },
      {
        root,
        rootMargin: "600px 0px 0px 0px"
      }
    );
    observer.observe(sentinel);
    return () => {
      root?.removeEventListener("scroll", markScrolled);
      observer.disconnect();
    };
  }, [hasHiddenMessages]);

  useEffect(() => {
    if (!shouldAutofocusTextInput()) {
      return;
    }

    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      const length = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(length, length);
    });

    return () => window.cancelAnimationFrame(handle);
  }, [payload.conversation.id]);

  const {
    send: wsSend,
    subscribe: wsSubscribe,
    unsubscribe: wsUnsubscribe,
    connected: wsConnected,
    failed: wsFailed
  } = useWebSocket({
    onMessage(msg) {
      dispatch({ type: "server_message", message: msg });
    }
  });

  useEffect(() => () => streamBuffer.reset(), [streamBuffer]);

  useEffect(() => {
    wsSubscribe(payload.conversation.id);
    return () => {
      wsUnsubscribe(payload.conversation.id);
    };
  }, [payload.conversation.id, wsSubscribe, wsUnsubscribe]);

  useEffect(() => {
    const bootstrap = readChatBootstrap(payload.conversation.id);
    bootstrapPayloadRef.current = bootstrap;
    bootstrapSubmittedRef.current = false;
  }, [payload.conversation.id]);

  useEffect(() => {
    const draft = consumeComposerDraft(payload.conversation.id);
    if (!draft) {
      return;
    }

    setInput(draft.content);
    setPendingAttachments(draft.attachments);
  }, [payload.conversation.id, setPendingAttachments]);

  useEffect(() => {
    if (!wsConnected || bootstrapSubmittedRef.current) {
      return;
    }

    const bootstrapPayload = bootstrapPayloadRef.current;

    if (!bootstrapPayload) {
      return;
    }

    bootstrapSubmittedRef.current = true;
    clearChatBootstrap(payload.conversation.id);
    void submitRef.current(
      bootstrapPayload.message,
      bootstrapPayload.attachments,
      bootstrapPayload.personaId,
      bootstrapPayload.research
    );
  }, [payload.conversation.id, wsConnected]);

  useEffect(() => {
    if (!wsFailed) {
      return;
    }

    dispatch({ type: "transport_failed", errorMessage: WS_UNAVAILABLE_MESSAGE });
  }, [wsFailed, dispatch]);

  async function pollConversationTitle() {
    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Unable to refresh conversation");
      }

      const result = (await response.json()) as {
        conversation: Conversation;
      };

      titlePollHaltedRef.current = false;
      dispatch({ type: "title_synced", conversation: result.conversation });
    } catch {}

    if (titlePollHaltedRef.current) {
      return;
    }

    titlePollAttemptsRef.current += 1;

    if (titlePollAttemptsRef.current >= 20) {
      stopTitlePolling();
      return;
    }

    titlePollTimeoutRef.current = window.setTimeout(() => {
      void pollConversationTitle();
    }, 1000);
  }

  useEffect(() => stopTitlePolling, []);

  useEffect(() => stopMessageSyncPolling, []);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") {
        return;
      }

      if (retainEmptyConversationRef.current) {
        return;
      }

      if (window.location.pathname === `/chat/${payload.conversation.id}`) {
        return;
      }

      if (docRef.current!.messages.length > 0) {
        return;
      }

      void deleteConversationIfStillEmpty(payload.conversation.id).catch(() => {});
    };
  }, [payload.conversation.id]);

  useEffect(() => {
    if (!isTemporaryToggled) {
      return;
    }

    const conversationId = payload.conversation.id;

    const handleBeforeUnload = () => {
      fetch(`/api/conversations/${conversationId}`, { method: "DELETE", keepalive: true }).catch(() => {});
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);

      if (typeof window === "undefined") {
        return;
      }

      if (window.location.pathname === `/chat/${conversationId}`) {
        return;
      }

      fetch(`/api/conversations/${conversationId}`, { method: "DELETE" }).catch(() => {});
    };
  }, [payload.conversation.id, isTemporaryToggled]);

  useEffect(() => {
    if (doc.titleGenerationStatus === "completed" || doc.titleGenerationStatus === "failed") {
      stopTitlePolling();
    }
  }, [doc.titleGenerationStatus]);

  useEffect(() => {
    if (!needsMessageSync || wsConnected) {
      stopMessageSyncPolling();
      return;
    }

    let cancelled = false;

    const syncConversation = async () => {
      try {
        const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error("Unable to refresh conversation");
        }

        const result = (await response.json()) as {
          conversation: Conversation;
          messages: Message[];
        };

        if (cancelled) {
          return;
        }

        messageSyncHaltedRef.current = false;
        dispatch({ type: "conversation_synced", conversation: result.conversation, messages: result.messages });
      } catch {}

      if (cancelled) {
        return;
      }

      if (messageSyncHaltedRef.current) {
        return;
      }

      messageSyncTimeoutRef.current = window.setTimeout(() => {
        void syncConversation();
      }, 1000);
    };

    void syncConversation();

    return () => {
      cancelled = true;
      stopMessageSyncPolling();
    };
  }, [dispatch, needsMessageSync, payload.conversation.id, wsConnected]);

  const selectedProfile = useMemo(
    () => payload.providerProfiles.find((profile) => profile.id === providerProfileId) ?? null,
    [payload.providerProfiles, providerProfileId]
  );

  const hasPendingImages = pendingAttachments.some((attachment) => attachment.kind === "image");
  const showVisionWarning =
    hasPendingImages &&
    selectedProfile &&
    selectedProfile.visionMode === "none";

  async function updateUserMessage(messageId: string, content: string) {
    const previousMessage = docRef.current!.messages.find((message) => message.id === messageId);

    if (!previousMessage || (rewind.pendingRewind && !(await rewind.commit()))) {
      return;
    }

    setError("");
    setUpdatingMessageId(messageId);
    dispatch({ type: "message_edit_started", messageId });

    try {
      const response = await fetch(`/api/messages/${messageId}/edit-restart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });

      if (!response.ok) {
        let message = "Unable to restart from edited message";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const result = (await response.json()) as {
        conversation?: Conversation;
        messages?: Message[];
      };

      dispatch({ type: "turn_restart_succeeded", conversation: result.conversation, messages: result.messages });
    } catch (caughtError) {
      dispatch({
        type: "turn_restart_failed",
        error: caughtError instanceof Error ? caughtError.message : "Unable to update message",
        clearSending: true
      });
      throw caughtError;
    } finally {
      setUpdatingMessageId((current) => (current === messageId ? null : current));
    }
  }

  async function forkMessage(messageId: string) {
    if (forkingMessageId || (rewind.pendingRewind && !(await rewind.commit()))) {
      return;
    }

    setError("");
    setForkingMessageId(messageId);

    try {
      const response = await fetch(`/api/messages/${messageId}/fork`, {
        method: "POST"
      });

      if (!response.ok) {
        let message = "Unable to fork conversation";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const result = (await response.json()) as {
        conversation?: {
          id?: string;
        };
        draft?: ComposerDraft | null;
      };
      const nextConversationId = result.conversation?.id;

      if (!nextConversationId) {
        throw new Error("Unable to fork conversation");
      }

      if (result.draft) {
        storeComposerDraft(nextConversationId, result.draft);
      }
      router.push(`/chat/${nextConversationId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to fork conversation"
      );
    } finally {
      setForkingMessageId((current) => (current === messageId ? null : current));
    }
  }

  function rewindMessage(messageId: string) {
    setError("");
    const rewindsUserMessage = docRef.current!.messages.find((message) => message.id === messageId)?.role === "user";
    void rewind.start(messageId).then(() => {
      if (rewindsUserMessage && shouldAutofocusTextInput()) {
        inputRef.current?.focus({ preventScroll: true });
      }
    });
  }

  async function retryAssistantMessage(messageId: string) {
    if (retryingMessageId || (rewind.pendingRewind && !(await rewind.commit()))) {
      return;
    }

    setError("");
    setRetryingMessageId(messageId);
    dispatch({ type: "message_retry_started", messageId });

    try {
      const response = await fetch(`/api/messages/${messageId}/retry`, {
        method: "POST"
      });

      if (!response.ok) {
        let message = "Message retry failed";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const result = (await response.json()) as {
        conversation?: Conversation;
        messages?: Message[];
      };

      dispatch({ type: "turn_restart_succeeded", conversation: result.conversation, messages: result.messages });
    } catch (caughtError) {
      dispatch({
        type: "turn_restart_failed",
        error: caughtError instanceof Error ? caughtError.message : "Message retry failed",
        clearSending: true
      });
    } finally {
      setRetryingMessageId((current) => (current === messageId ? null : current));
    }
  }

  async function regenerateUserMessage(messageId: string) {
    if (regeneratingMessageId || (rewind.pendingRewind && !(await rewind.commit()))) {
      return;
    }

    if (docRef.current!.streamMessageId && !docRef.current!.isStopPending) {
      stopActiveTurn();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    setError("");
    setRegeneratingMessageId(messageId);
    dispatch({ type: "message_regenerate_started", messageId });

    try {
      const response = await fetch(`/api/messages/${messageId}/regenerate`, {
        method: "POST"
      });

      if (!response.ok) {
        let message = "Message regeneration failed";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const result = (await response.json()) as {
        conversation?: Conversation;
        messages?: Message[];
      };

      dispatch({
        type: "turn_restart_succeeded",
        conversation: result.conversation,
        messages: result.messages,
        active: Boolean(result.conversation),
        sending: true
      });
    } catch (caughtError) {
      dispatch({
        type: "turn_restart_failed",
        error: caughtError instanceof Error ? caughtError.message : "Message regeneration failed",
        clearSending: false
      });
    } finally {
      setRegeneratingMessageId((current) => (current === messageId ? null : current));
    }
  }

  async function approveMemoryProposal(
    actionId: string,
    overrides?: { content?: string; category?: MemoryCategory }
  ) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(overrides ?? {})
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to approve memory proposal");
      }

      dispatch({ type: "message_action_replaced", action: result.action });
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to approve memory proposal";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function dismissMemoryProposal(actionId: string) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/dismiss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to dismiss memory proposal");
      }

      dispatch({ type: "message_action_replaced", action: result.action });
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to dismiss memory proposal";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function approveToolApproval(
    actionId: string,
    options?: { allowAlways?: boolean }
  ) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ allowAlways: options?.allowAlways ?? false })
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to approve tool request");
      }

      dispatch({ type: "stream_action_replaced", action: result.action });
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to approve tool request";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function dismissToolApproval(actionId: string) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/dismiss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to deny tool request");
      }

      dispatch({ type: "stream_action_replaced", action: result.action });
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to deny tool request";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function approveAutomationProposal(
    actionId: string,
    overrides?: AutomationProposalOverrides
  ) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(overrides ?? {})
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to schedule automation");
      }

      dispatch({ type: "message_action_replaced", action: result.action });
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to schedule automation";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function dismissAutomationProposal(actionId: string) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/dismiss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to ignore automation proposal");
      }

      dispatch({ type: "message_action_replaced", action: result.action });
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to ignore automation proposal";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function postMessageDraftAction(
    actionId: string,
    endpoint: "approve" | "dismiss",
    body: Record<string, unknown>,
    fallbackError: string
  ) {
    const response = await fetch(`/api/message-actions/${actionId}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const result = (await response.json().catch(() => ({}))) as {
      action?: MessageAction;
      error?: string;
    };

    if (!response.ok || !result.action) {
      throw new Error(result.error ?? fallbackError);
    }

    dispatch({ type: "message_action_replaced", action: result.action });
  }

  async function sendMessageDraft(actionId: string, fields?: Record<string, string>) {
    await postMessageDraftAction(actionId, "approve", fields ? { fields } : {}, "Unable to send the draft");
  }

  async function discardMessageDraft(actionId: string) {
    await postMessageDraftAction(actionId, "dismiss", {}, "Unable to discard the draft");
  }

  async function updateProviderProfile(nextProviderProfileId: string) {
    const previousProviderProfileId = providerProfileId;
    setError("");
    setProviderProfileId(nextProviderProfileId);

    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ providerProfileId: nextProviderProfileId })
      });

      if (!response.ok) {
        let message = "Unable to update provider profile";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

    } catch (caughtError) {
      setProviderProfileId(previousProviderProfileId);
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to update provider profile"
      );
    }
  }

  async function updateReasoningEffort(nextReasoningEffort: ReasoningEffort) {
    const previousReasoningEffort = reasoningEffort;
    setError("");
    setReasoningEffort(nextReasoningEffort);

    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ reasoningEffort: nextReasoningEffort })
      });

      if (!response.ok) {
        let message = "Unable to update reasoning effort";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }
    } catch (caughtError) {
      setReasoningEffort(previousReasoningEffort);
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to update reasoning effort"
      );
    }
  }

  function dismissComposerKeyboardOnTouch() {
    if (shouldAutofocusTextInput()) {
      return;
    }
    inputRef.current?.blur();
  }

  async function submit(
    nextInput = input,
    nextPendingAttachments = pendingAttachments,
    nextPersonaId?: string,
    nextResearch?: boolean | ChatResearchOptions
  ) {
    if (rewind.pendingRewind && !(await rewind.commit())) {
      return;
    }

    const value = nextInput.trim();
    const effectivePersonaId = nextPersonaId ?? personaId;
    const hasActiveTurn = selectHasActiveTurn(docRef.current!);

    if (
      speechSnapshot.phase === "listening" ||
      speechSnapshot.phase === "transcribing" ||
      speechSnapshot.phase === "cleaning" ||
      isUploadingAttachments ||
      updatingMessageId !== null
    ) {
      return;
    }

    if (wsFailed) {
      setError(WS_UNAVAILABLE_MESSAGE);
      return;
    }

    if (hasActiveTurn) {
      if (!value) {
        return;
      }

      setError("");
      setInput("");
      dismissComposerKeyboardOnTouch();
      wsSend({
        type: "queue_message",
        conversationId: payload.conversation.id,
        content: value
      });
      return;
    }

    if ((!value && nextPendingAttachments.length === 0) || docRef.current!.isSending) {
      return;
    }

    if (nextResearch === undefined && researchPlan.draft) {
      if (!value) {
        return;
      }
      setError("");
      setInput("");
      dismissComposerKeyboardOnTouch();
      researchPlan.refine(value);
      return;
    }

    const researchRequest =
      typeof nextResearch === "object" && nextResearch.plan?.length
        ? nextResearch
        : (nextResearch ?? isResearchToggled)
          ? null
          : undefined;
    if (researchRequest === null) {
      if (!value) {
        return;
      }
      setError("");
      setInput("");
      dismissComposerKeyboardOnTouch();
      researchUserMessageIdRef.current = null;
      const attachmentIds = nextPendingAttachments.map((attachment) => attachment.id);
      researchPlan.open({
        message: value,
        load: async () => {
          const response = await fetch(`/api/conversations/${payload.conversation.id}/research`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: value, attachmentIds })
          });
          if (!response.ok) {
            throw new Error("The research plan could not be generated");
          }
          const data = (await response.json()) as { message?: Message; plan?: unknown };
          if (data.message) {
            const persisted = data.message;
            researchUserMessageIdRef.current = persisted.id;
            setPendingAttachments([]);
            dispatch({ type: "research_message_persisted", message: persisted });
            if (docRef.current!.titleGenerationStatus === "pending") {
              startTitlePolling();
            }
          }
          return data.plan;
        },
        regenerate: async () => {
          const response = await fetch("/api/research/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: value, providerProfileId })
          });
          if (!response.ok) {
            throw new Error("The research plan could not be generated");
          }
          return ((await response.json()) as { plan?: unknown }).plan;
        },
        refine: async ({ plan, instruction }) => {
          const response = await fetch("/api/research/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: value, currentPlan: plan, instruction, providerProfileId })
          });
          if (!response.ok) {
            throw new Error("The plan could not be updated");
          }
          return ((await response.json()) as { plan?: unknown }).plan;
        }
      });
      return;
    }

    setError("");
    setInput("");
    dismissComposerKeyboardOnTouch();
    setPendingAttachments([]);
    dispatch({ type: "submission_started", content: value, attachments: nextPendingAttachments });

    wsSend({
      type: "message",
      conversationId: payload.conversation.id,
      content: value,
      attachmentIds: nextPendingAttachments.map((attachment) => attachment.id),
      personaId: effectivePersonaId ?? undefined,
      research: researchRequest
    });
    setIsResearchToggled(false);

    if (docRef.current!.titleGenerationStatus === "pending") {
      startTitlePolling();
    }
  }

  function stopActiveTurn() {
    const current = docRef.current!;
    if (!current.streamMessageId || current.isStopPending) {
      return;
    }

    dispatch({ type: "stop_requested" });
    wsSend({
      type: "stop",
      conversationId: payload.conversation.id
    });
  }

  submitRef.current = submit;

  function ensureRealtimeConnection() {
    if (!wsFailed) {
      return true;
    }

    setError(WS_UNAVAILABLE_MESSAGE);
    return false;
  }

  async function updateQueuedMessage(queuedMessageId: string, content: string) {
    if (!ensureRealtimeConnection()) {
      return;
    }

    setError("");
    wsSend({
      type: "update_queued_message",
      conversationId: payload.conversation.id,
      queuedMessageId,
      content
    });
  }

  async function deleteQueuedMessage(queuedMessageId: string) {
    if (!ensureRealtimeConnection()) {
      return;
    }

    setError("");
    wsSend({
      type: "delete_queued_message",
      conversationId: payload.conversation.id,
      queuedMessageId
    });
  }

  async function sendQueuedMessageNow(queuedMessageId: string) {
    if (!ensureRealtimeConnection()) {
      return;
    }

    setError("");
    dispatch({ type: "queued_message_send_now_requested", queuedMessageId });
    wsSend({
      type: "send_queued_message_now",
      conversationId: payload.conversation.id,
      queuedMessageId
    });
  }

  const onUpdateUserMessageStable = useStableHandler(updateUserMessage);
  const onApproveMemoryProposalStable = useStableHandler(approveMemoryProposal);
  const onDismissMemoryProposalStable = useStableHandler(dismissMemoryProposal);
  const onApproveToolApprovalStable = useStableHandler(approveToolApproval);
  const onDismissToolApprovalStable = useStableHandler(dismissToolApproval);
  const onApproveAutomationProposalStable = useStableHandler(approveAutomationProposal);
  const onDismissAutomationProposalStable = useStableHandler(dismissAutomationProposal);
  const onSendMessageDraftStable = useStableHandler(sendMessageDraft);
  const onDiscardMessageDraftStable = useStableHandler(discardMessageDraft);
  const onForkMessageStable = useStableHandler(forkMessage);
  const onRewindMessageStable = useStableHandler(rewindMessage);
  const onRemovePendingAttachmentStable = useStableHandler(async (attachmentId: string) => {
    if (rewind.pendingRewind && !(await rewind.commit())) {
      return;
    }
    await removePendingAttachment(attachmentId);
  });
  const canForkMessages = payload.conversation.conversationOrigin !== "bot";
  const canRewindMessages = !doc.isActive && !doc.isSending;
  const onRetryAssistantMessageStable = useStableHandler(retryAssistantMessage);
  const onRegenerateUserMessageStable = useStableHandler(regenerateUserMessage);
  const onPreviewAttachmentStable = useStableHandler(previewController.openAttachmentPreview);

  return (
    <div
      data-testid="chat-view-root"
      className="relative flex min-h-0 flex-1 w-full flex-col bg-[var(--background)]"
    >
      <div
        className="contents"
        {...fileDropProps}
      >
      {isDraggingFiles ? <FileDropOverlay /> : null}
      {hideConversationHeader ? null : (
        <div className="border-b border-white/4 px-4 py-3.5 md:px-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-[var(--text)] truncate text-sm">{doc.title}</div>
            </div>
            <div className="hidden md:flex items-center gap-1">
              {canShare ? (
                <button
                  type="button"
                  className="h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/6 bg-white/[0.02] text-white/40 transition-colors duration-150 hover:border-white/10 hover:bg-white/[0.05] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 flex"
                  onClick={openShareModal}
                  aria-label="Share conversation"
                  title="Share conversation"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                className="h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)] transition-all duration-200 hover:opacity-90 hover:scale-[0.98] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 flex"
                onClick={async () => {
                  try {
                    await deleteConversationIfStillEmpty(payload.conversation.id);
                    const res = await fetch("/api/conversations", { method: "POST" });
                    const data = (await res.json()) as { conversation: Conversation };
                    router.push(`/chat/${data.conversation.id}`);
                  } catch {}
                }}
                aria-label="New chat"
                title="New chat"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ ["--composer-height" as string]: `${composerAreaHeight}px` }}
      >
      <ConversationContainer>
        <StickToBottomBridge
          scrollToBottomRef={scrollToBottomRef}
          setScrollTargetRef={setScrollTargetRef}
        />
        <ConversationContent
          className="gap-2.5 px-2 pt-4 md:gap-4 md:px-8"
        >
          {hiddenMessageCount > 0 ? (
            <div
              ref={earlierMessagesSentinelRef}
              aria-hidden
              data-testid="earlier-messages-sentinel"
              className="h-px w-full"
            />
          ) : null}
          {hiddenMessageCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                expandAnchorMessageIdRef.current = visibleMessages[0]?.id ?? null;
                setVisibleMessageLimit((current) => current + VISIBLE_MESSAGE_INCREMENT);
              }}
              className="mx-auto mb-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-white/55 transition hover:bg-white/[0.08] hover:text-white/80"
            >
              Show earlier messages ({hiddenMessageCount})
            </button>
          ) : null}
          {(() => {
            if (initialMessageIdsRef.current === null) {
              initialMessageIdsRef.current = new Set(renderableMessages.map((m) => m.id));
            }
            return null;
          })()}
          {visibleMessages.map((message, index) => {
            const isStreamingMessage = message.id === doc.streamMessageId;

            const wasPresentOnInit = initialMessageIdsRef.current!.has(message.id);
            const hasBeenAnimated = animatedMessageIdsRef.current.has(message.id);
            const shouldAnimate = hasBeenAnimated || (!wasPresentOnInit && message.role === "assistant");
            if (shouldAnimate && !hasBeenAnimated) {
              animatedMessageIdsRef.current.add(message.id);
            }

            return (
              <div
                key={doc.renderKeyByMessageId.get(message.id) ?? message.id}
                data-message-id={message.id}
                className={shouldAnimate ? "animate-slide-up" : undefined}
                style={shouldAnimate ? { animationFillMode: "forwards" } : undefined}
              >
                <StreamingMessage
                  active={isStreamingMessage}
                  buffer={streamBuffer}
                  message={message}
                  timeline={isStreamingMessage ? doc.streamTimeline : EMPTY_TIMELINE}
                  hasReceivedFirstToken={isStreamingMessage ? doc.hasReceivedFirstToken : false}
                  compactionInProgress={isStreamingMessage ? doc.compactionInProgress : false}
                  thinkingDuration={isStreamingMessage ? doc.thinkingDuration : undefined}
                  confirmExternalLinks={payload.settings.confirmExternalLinks}
                  toolCallDisplay={payload.settings.toolCallDisplay}
                  onPreviewAttachment={onPreviewAttachmentStable}
                  onUpdateUserMessage={onUpdateUserMessageStable}
                  onApproveMemoryProposal={onApproveMemoryProposalStable}
                  onDismissMemoryProposal={onDismissMemoryProposalStable}
                  onApproveToolApproval={onApproveToolApprovalStable}
                  onDismissToolApproval={onDismissToolApprovalStable}
                  onApproveAutomationProposal={onApproveAutomationProposalStable}
                  onDismissAutomationProposal={onDismissAutomationProposalStable}
                  onSendMessageDraft={onSendMessageDraftStable}
                  onDiscardMessageDraft={onDiscardMessageDraftStable}
                  onForkMessage={canForkMessages && !message.id.startsWith("local_") ? onForkMessageStable : undefined}
                  onRewindMessage={
                    canRewindMessages &&
                    !message.id.startsWith("local_") &&
                    (message.role === "user" || index < visibleMessages.length - 1)
                      ? onRewindMessageStable
                      : undefined
                  }
                  onRetryAssistantMessage={onRetryAssistantMessageStable}
                  onRegenerateUserMessage={index === lastUserMsgIndex ? onRegenerateUserMessageStable : undefined}
                  isUpdating={updatingMessageId === message.id}
                  isForking={forkingMessageId === message.id}
                  isRetrying={retryingMessageId === message.id}
                  isRegenerating={regeneratingMessageId === message.id}
                  referenceCandidates={referenceCandidates}
                  computerConversationId={payload.conversation.id}
                  delegationReplies={delegationReplies}
                />
              </div>
            );
          })}
          {error ? (
            <div role="alert" className="mx-auto mt-3 max-w-md rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300 text-center animate-slide-up">
              {error}
            </div>
          ) : null}
          <div ref={contentEndRef} />
          <div aria-hidden style={{ height: "calc(var(--composer-height, 160px) + 24px)" }} />
        </ConversationContent>
        <ConversationScrollButton />
      </ConversationContainer>

        <Toast
          inline
          visible={rewind.isUndoVisible}
          variant="neutral"
          message={rewind.undoLabel}
          action={{ label: "Undo", onClick: rewind.undo }}
          onClose={() => void rewind.commit()}
          onHoldChange={rewind.hold}
          className="bottom-[calc(var(--composer-height,80px)+3.25rem)] left-1/2 -translate-x-1/2 md:bottom-[calc(var(--composer-height,160px)+2.75rem)]"
        />
        <div ref={composerAreaRef} className="absolute inset-x-0 bottom-0 z-50 pointer-events-none has-[[role=listbox]]:z-[60]">
         <div
           aria-hidden
           className="absolute inset-x-0 -top-14 bottom-0 md:hidden"
           style={{ background: "linear-gradient(to top, var(--background) 0%, var(--background) 46%, transparent 100%)" }}
         />
         <div className="mx-auto w-full max-w-[980px] px-3 sm:px-4 md:px-8 pt-1 pb-composer-safe pointer-events-auto">
          <div>
            <QueuedMessageBanner
              items={doc.queuedMessages}
              onEdit={updateQueuedMessage}
              onDelete={deleteQueuedMessage}
              onSendNow={sendQueuedMessageNow}
              redirectingIds={doc.isActive ? redirectingIds : undefined}
            />
          </div>
          <div className="relative">
          {researchPlan.draft ? (
            <ResearchPlanCard
              draft={researchPlan.draft}
              onUpdateStep={researchPlan.updateStep}
              onAddStep={researchPlan.addStep}
              onRemoveStep={researchPlan.removeStep}
              onMoveStep={researchPlan.moveStep}
              onRegenerate={researchPlan.regenerate}
              onCancel={() => {
                const pendingMessageId = researchUserMessageIdRef.current;
                researchUserMessageIdRef.current = null;
                if (pendingMessageId) {
                  dispatch({ type: "research_draft_discarded", messageId: pendingMessageId });
                  fetch(`/api/conversations/${payload.conversation.id}/research`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userMessageId: pendingMessageId })
                  }).catch(() => {});
                }
                setInput(researchPlan.draft?.message ?? "");
                researchPlan.close();
              }}
              onStart={() => {
                const draft = researchPlan.draft;
                if (!draft) return;
                const plan = draft.plan.map((step) => step.trim());
                const pendingMessageId = researchUserMessageIdRef.current;
                researchUserMessageIdRef.current = null;
                researchPlan.close();
                setIsResearchToggled(false);
                if (!pendingMessageId) {
                  void submit(draft.message, pendingAttachments, undefined, { plan });
                  return;
                }
                dispatch({ type: "research_turn_started" });
                fetch(`/api/conversations/${payload.conversation.id}/research`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userMessageId: pendingMessageId, plan, personaId: personaId ?? undefined })
                })
                  .then(async (response) => {
                    if (!response.ok) {
                      dispatch({ type: "research_turn_failed" });
                      setError("Unable to start the research turn");
                    }
                  })
                  .catch(() => {
                    dispatch({ type: "research_turn_failed" });
                    setError("Unable to start the research turn");
                  });
              }}
            />
          ) : null}
          <ChatComposer
            input={input}
            onInputChange={setInput}
            onSubmit={submit}
            isSending={doc.isSending || updatingMessageId !== null}
            pendingAttachments={pendingAttachments}
            isUploadingAttachments={isUploadingAttachments}
            onUploadFiles={uploadFiles}
            onRemovePendingAttachment={onRemovePendingAttachmentStable}
            showVisionWarning={Boolean(showVisionWarning)}
            providerProfiles={payload.providerProfiles}
            providerProfileId={providerProfileId}
            onProviderProfileChange={updateProviderProfile}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={updateReasoningEffort}
            personas={personas}
            personaId={personaId}
            onPersonaChange={setPersonaId}
            textareaRef={inputRef}
            references={composerReferences}
            onReferencesOpen={refreshComposerReferences}
            usedTokens={doc.usedTokens}
            compactionLimit={doc.compactionLimit}
            memoriesUsed={doc.memoryUsage?.used ?? null}
            memoriesTotal={doc.memoryUsage?.total ?? null}
            modelContextLimit={selectedProfile?.modelContextLimit ?? 128000}
            hasMessages={doc.messages.length > 0}
            canStop={!!doc.streamMessageId && !doc.isStopPending && doc.isActive}
            isStopPending={doc.isStopPending}
            onStop={stopActiveTurn}
            speechPhase={speechSnapshot.phase}
            speechLevel={speechSnapshot.level}
            speechError={speechSnapshot.error}
            queueingEnabled={doc.isActive}
            redirectsWhileBusy={redirectsWhileBusy}
            isResearch={isResearchToggled}
            onResearchChange={setIsResearchToggled}
            planRefinementActive={Boolean(researchPlan.draft)}
            planRefinementBusy={
              researchPlan.draft?.status === "loading" || researchPlan.draft?.status === "updating"
            }
            isTemporary={isTemporaryToggled}
            showTemporaryToggle={doc.messages.length === 0 && payload.conversation.conversationOrigin === "manual"}
            onTemporaryChange={(value: boolean) => {
              setIsTemporaryToggled(value);
              fetch(`/api/conversations/${payload.conversation.id}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ isTemporary: value })
              }).catch(() => {});
            }}
            compactOnMobile
            onStartSpeech={onStartSpeech}
            onStopSpeech={onStopSpeech}
          />
           </div>
        </div>
      </div>
      </div>
      {previewController.previewAttachment ? (
        <AttachmentPreviewModal
          attachment={previewController.previewAttachment}
          state={previewController.previewState}
          onClose={previewController.closeAttachmentPreview}
          onRetry={() =>
            void previewController.openAttachmentPreview(
              previewController.previewAttachment!
            )
          }
        />
      ) : null}
      </div>
    </div>
  );
}
