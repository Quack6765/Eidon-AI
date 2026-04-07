"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatComposer } from "@/components/chat-composer";
import { storeChatBootstrap } from "@/lib/chat-bootstrap";
import { supportsImageInput } from "@/lib/model-capabilities";
import { shouldAutofocusTextInput } from "@/lib/utils";
import type {
  Conversation,
  MessageAttachment,
  ProviderProfileSummary
} from "@/lib/types";

type HomeViewProps = {
  providerProfiles: ProviderProfileSummary[];
  defaultProviderProfileId: string;
};

export function HomeView({
  providerProfiles,
  defaultProviderProfileId
}: HomeViewProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [providerProfileId, setProviderProfileId] = useState(defaultProviderProfileId);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [personas, setPersonas] = useState<Array<{ id: string; name: string }>>([]);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [draftConversationId, setDraftConversationId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);

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

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((d) => {
        if (d.personas) setPersonas(d.personas);
      })
      .catch(() => {});
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
    !supportsImageInput(
      selectedProfile.model,
      selectedProfile.apiMode as "responses" | "chat_completions"
    );

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
        providerProfileId
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

  async function uploadFiles(files: File[]) {
    if (!files.length) {
      return;
    }

    setError("");
    setIsUploadingAttachments(true);

    try {
      const conversationId = await ensureDraftConversation();
      const formData = new FormData();
      formData.append("conversationId", conversationId);
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/attachments", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        let message = "Unable to upload attachments";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const data = (await response.json()) as { attachments: MessageAttachment[] };
      setPendingAttachments((current) => [...current, ...data.attachments]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to upload attachments"
      );
    } finally {
      setIsUploadingAttachments(false);
    }
  }

  async function removePendingAttachment(attachmentId: string) {
    setError("");

    try {
      const response = await fetch(`/api/attachments/${attachmentId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        let message = "Unable to remove attachment";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      setPendingAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId)
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to remove attachment"
      );
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

  async function submit() {
    const value = input.trim();

    if ((!value && pendingAttachments.length === 0) || isSubmitting || isUploadingAttachments) {
      return;
    }

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
        personaId: personaId ?? undefined
      });
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
      className="relative flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col items-center justify-center px-4 pb-8"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }

        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }

        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }

        event.preventDefault();
        dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);

        if (dragDepthRef.current === 0) {
          setIsDraggingFiles(false);
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) {
          return;
        }

        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        void uploadFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {isDraggingFiles ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--panel)] px-6 py-5 text-center shadow-[var(--shadow)]">
            <div className="text-sm font-medium text-[var(--text)]">Drop files to attach</div>
            <div className="mt-1 text-xs text-white/45">
              Images and text-like files are supported
            </div>
          </div>
        </div>
      ) : null}
      <div className="w-full md:max-w-[980px] px-4 animate-slide-up">
        <div className="mb-10 text-center">
          <h2
            className="mb-3 text-3xl font-medium text-[var(--text)] md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What&apos;s on your mind?
          </h2>
        </div>

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
          personas={personas}
          personaId={personaId}
          onPersonaChange={setPersonaId}
          textareaRef={textareaRef}
          usedTokens={null}
          modelContextLimit={selectedProfile?.modelContextLimit ?? 128000}
          compactionThreshold={selectedProfile?.compactionThreshold ?? 0.78}
          hasMessages={false}
        />

        {error ? (
          <div className="mt-3 rounded-xl border border-red-400/10 bg-red-500/8 px-4 py-3 text-center text-sm text-red-300 animate-slide-up">
            {error}
          </div>
        ) : null}
      </div>
    </main>
  );
}
