import { useState } from "react";

import type { MessageAttachment } from "@/lib/types";

async function responseError(response: Response, fallback: string) {
  try {
    return ((await response.json()) as { error?: string }).error ?? fallback;
  } catch {
    return fallback;
  }
}

export function usePendingAttachments(input: {
  resolveConversationId: () => string | Promise<string>;
  onError: (message: string) => void;
}) {
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    input.onError("");
    setIsUploadingAttachments(true);
    try {
      const conversationId = await input.resolveConversationId();
      const formData = new FormData();
      formData.append("conversationId", conversationId);
      files.forEach((file) => formData.append("files", file));
      const response = await fetch("/api/attachments", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await responseError(response, "Unable to upload attachments"));
      const data = (await response.json()) as { attachments: MessageAttachment[] };
      setPendingAttachments((current) => [...current, ...data.attachments]);
    } catch (error) {
      input.onError(error instanceof Error ? error.message : "Unable to upload attachments");
    } finally {
      setIsUploadingAttachments(false);
    }
  }

  async function removePendingAttachment(attachmentId: string) {
    input.onError("");
    try {
      const response = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Unable to remove attachment"));
      setPendingAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId)
      );
    } catch (error) {
      input.onError(error instanceof Error ? error.message : "Unable to remove attachment");
    }
  }

  return {
    pendingAttachments,
    setPendingAttachments,
    isUploadingAttachments,
    uploadFiles,
    removePendingAttachment
  };
}
