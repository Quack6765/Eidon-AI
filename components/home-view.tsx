"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatComposer } from "@/components/chat-composer";
import { FileDropOverlay } from "@/components/file-drop-overlay";
import { useComposerSpeech } from "@/hooks/use-composer-speech";
import { useFileDrop } from "@/hooks/use-file-drop";
import { usePendingAttachments } from "@/hooks/use-pending-attachments";
import { usePersonas } from "@/hooks/use-personas";
import { markHomeSubmitSidebarAutoHide, storeChatBootstrap } from "@/lib/chat-bootstrap";
import type { ChatResearchOptions } from "@/lib/types";
import { cn, shouldAutofocusTextInput } from "@/lib/utils";
import type {
  AppSettings,
  Conversation,
  ProviderProfileSummary,
  ReasoningEffort
} from "@/lib/types";

type HomeViewProps = {
  providerProfiles: ProviderProfileSummary[];
  defaultProviderProfileId: string | null;
  settings: Pick<AppSettings, "speechTranscription" | "speechCleanupEnabled">;
};

export function HomeView({
  providerProfiles,
  defaultProviderProfileId,
  settings
}: HomeViewProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [providerProfileId, setProviderProfileId] = useState(
    defaultProviderProfileId ?? providerProfiles[0]?.id ?? ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const personas = usePersonas();
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [draftConversationId, setDraftConversationId] = useState<string | null>(null);
  const [isTemporary, setIsTemporary] = useState(false);
  const [isResearch, setIsResearch] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [entranceAnimDone, setEntranceAnimDone] = useState(false);
  const onEntranceAnimEnd = useCallback(() => setEntranceAnimDone(true), []);
  const { speechSnapshot, onStartSpeech, onStopSpeech } = useComposerSpeech({
    selection: settings.speechTranscription,
    cleanupEnabled: settings.speechCleanupEnabled,
    setDraft: setInput,
    clearError: () => setError("")
  });
  const {
    pendingAttachments,
    isUploadingAttachments,
    uploadFiles,
    removePendingAttachment
  } = usePendingAttachments({
    resolveConversationId: ensureDraftConversation,
    onError: setError
  });
  const { isDraggingFiles, fileDropProps } = useFileDrop((files) => void uploadFiles(files));

  useEffect(() => {
    if (!shouldAutofocusTextInput()) {
      return;
    }

    const handle = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    });

    return () => window.cancelAnimationFrame(handle);
  }, []);

  const selectedProfile = useMemo(
    () =>
      providerProfiles.find((profile) => profile.id === providerProfileId) ?? null,
    [providerProfiles, providerProfileId]
  );
  const hasPendingImages = pendingAttachments.some(
    (attachment) => attachment.kind === "image"
  );
  const showVisionWarning =
    hasPendingImages &&
    selectedProfile &&
    selectedProfile.visionMode === "none";

  async function ensureDraftConversation() {
    if (draftConversationId) {
      return draftConversationId;
    }

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        providerProfileId,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        isTemporary
      })
    });

    if (!response.ok) {
      let message = "Unable to start a new conversation";

      try {
        const failure = (await response.json()) as { error?: string };
        message = failure.error ?? message;
      } catch {}

      throw new Error(message);
    }

    const payload = (await response.json()) as { conversation: Conversation };
    setDraftConversationId(payload.conversation.id);
    return payload.conversation.id;
  }

  async function syncDraftConversation(updates: {
    providerProfileId?: string;
    reasoningEffort?: ReasoningEffort;
  }) {
    if (!draftConversationId) {
      return;
    }

    const response = await fetch(`/api/conversations/${draftConversationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      let message = "Unable to update conversation settings";

      try {
        const failure = (await response.json()) as { error?: string };
        message = failure.error ?? message;
      } catch {}

      throw new Error(message);
    }
  }

  async function handleProviderProfileChange(nextProviderProfileId: string) {
    const previousProviderProfileId = providerProfileId;
    setError("");
    setProviderProfileId(nextProviderProfileId);

    try {
      await syncDraftConversation({ providerProfileId: nextProviderProfileId });
    } catch (caughtError) {
      setProviderProfileId(previousProviderProfileId);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update conversation settings"
      );
    }
  }

  async function handleReasoningEffortChange(nextReasoningEffort: ReasoningEffort) {
    const previousReasoningEffort = reasoningEffort;
    setError("");
    setReasoningEffort(nextReasoningEffort);

    try {
      await syncDraftConversation({ reasoningEffort: nextReasoningEffort });
    } catch (caughtError) {
      setReasoningEffort(previousReasoningEffort);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update conversation settings"
      );
    }
  }

  async function submit() {
    const value = input.trim();

    if (
      speechSnapshot.phase === "listening" ||
      speechSnapshot.phase === "transcribing" ||
      speechSnapshot.phase === "cleaning" ||
      (!value && pendingAttachments.length === 0) ||
      isSubmitting ||
      isUploadingAttachments
    ) {
      return;
    }

    await startConversation(value, isResearch && value ? {} : undefined);
  }

  async function startConversation(value: string, research?: ChatResearchOptions) {
    setError("");
    setIsSubmitting(true);

    try {
      const conversationId = await ensureDraftConversation();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      storeChatBootstrap(conversationId, {
        message: value,
        attachments: pendingAttachments,
        personaId: personaId ?? undefined,
        ...(research ? { research } : {})
      });
      markHomeSubmitSidebarAutoHide(conversationId);
      router.push(`/chat/${conversationId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to start a new conversation"
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main
      className="relative flex min-h-0 flex-1 flex-col items-center px-4 sm:justify-center sm:pb-8"
      {...fileDropProps}
    >
      {isDraggingFiles ? <FileDropOverlay /> : null}

      <div
        className={cn(
          "flex flex-1 items-center justify-center w-full sm:flex-initial sm:mb-16",
          !entranceAnimDone && "animate-slide-up"
        )}
        onAnimationEnd={onEntranceAnimEnd}
      >
        <div className="w-full md:max-w-[980px] px-4 text-center">
          <h2
            className="mb-3 text-3xl font-medium text-[var(--text)] md:text-4xl"
            style={{ fontFamily: "var(--font-wordmark), 'Eurostile', 'Space Grotesk', sans-serif" }}
          >
            Let&apos;s get to work
          </h2>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-50 px-3 pb-composer-safe pointer-events-none md:relative md:inset-auto md:z-auto md:w-full md:px-0 md:pb-0 md:pointer-events-auto">
        <div className="mx-auto w-full max-w-[980px] px-3 sm:px-4 md:px-8 pt-1 pointer-events-auto">
          <ChatComposer
            input={input}
            onInputChange={setInput}
            onSubmit={submit}
            isSending={isSubmitting}
            pendingAttachments={pendingAttachments}
            isUploadingAttachments={isUploadingAttachments}
            onUploadFiles={uploadFiles}
            onRemovePendingAttachment={removePendingAttachment}
            showVisionWarning={Boolean(showVisionWarning)}
            providerProfiles={providerProfiles}
            providerProfileId={providerProfileId}
            onProviderProfileChange={handleProviderProfileChange}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={handleReasoningEffortChange}
            personas={personas}
            personaId={personaId}
            onPersonaChange={setPersonaId}
            textareaRef={textareaRef}
            usedTokens={null}
            modelContextLimit={selectedProfile?.modelContextLimit ?? 128000}
            compactionLimit={0}
            hasMessages={false}
            canStop={false}
            isStopPending={false}
            onStop={() => {}}
            speechPhase={speechSnapshot.phase}
            speechLevel={speechSnapshot.level}
            speechError={speechSnapshot.error}
            onStartSpeech={onStartSpeech}
            onStopSpeech={onStopSpeech}
            isTemporary={isTemporary}
            showTemporaryToggle={true}
            onTemporaryChange={setIsTemporary}
            isResearch={isResearch}
            onResearchChange={setIsResearch}
            compactOnMobile
          />

          {error ? (
            <div className="mt-3 rounded-xl border border-red-400/10 bg-red-500/8 px-4 py-3 text-center text-sm text-red-300 animate-slide-up">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
