import { useRef, useState } from "react";

import type { MessageAttachment } from "@/lib/types";

const UPLOAD_CONCURRENCY = 3;
const MAX_UPLOAD_ATTEMPTS = 2;

type FailedUpload = { file: File; error: string };

async function responseError(response: Response, fallback: string) {
  try {
    return ((await response.json()) as { error?: string }).error ?? fallback;
  } catch {
    return fallback;
  }
}

function isRetryableStatus(status: number) {
  return status >= 500 || status === 408 || status === 429;
}

function describeFailures(failures: FailedUpload[], total: number) {
  const details = failures.map((failure) => `${failure.file.name || "file"}: ${failure.error}`);
  return [
    `${failures.length} of ${total} file${total === 1 ? "" : "s"} failed to upload.`,
    ...details,
    "Re-attach the failed files to retry."
  ].join(" ");
}

export function usePendingAttachments(input: {
  resolveConversationId: () => string | Promise<string>;
  onError: (message: string) => void;
}) {
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const failedUploadsRef = useRef<FailedUpload[]>([]);

  async function uploadOne(conversationId: string, file: File): Promise<MessageAttachment> {
    let lastError = "Unable to upload attachments";

    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      const formData = new FormData();
      formData.append("conversationId", conversationId);
      formData.append("files", file);

      let response: Response;
      try {
        response = await fetch("/api/attachments", { method: "POST", body: formData });
      } catch {
        lastError = "Network error during upload";
        continue;
      }

      if (response.ok) {
        const data = (await response.json()) as { attachments: MessageAttachment[] };
        const attachment = data.attachments[0];
        if (attachment) return attachment;
        lastError = "Server returned no attachment";
        break;
      }

      lastError = await responseError(response, "Unable to upload attachments");
      if (!isRetryableStatus(response.status)) break;
    }

    throw new Error(lastError);
  }

  async function uploadFiles(files: File[]) {
    const queued = [...failedUploadsRef.current.map((failure) => failure.file), ...files];
    failedUploadsRef.current = [];
    if (!queued.length) return;

    input.onError("");
    setIsUploadingAttachments(true);

    try {
      const conversationId = await input.resolveConversationId();
      const failures: FailedUpload[] = [];
      const successes: MessageAttachment[] = [];

      for (const file of queued) {
        if (file.size === 0) {
          failures.push({
            file,
            error: "the photo did not finish downloading from iCloud — re-select it"
          });
        }
      }

      const uploadable = queued.filter((file) => file.size > 0);
      const results: Array<MessageAttachment | FailedUpload | null> = new Array(uploadable.length).fill(null);
      let nextIndex = 0;

      async function worker() {
        for (;;) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= uploadable.length) return;
          const file = uploadable[index];
          try {
            results[index] = await uploadOne(conversationId, file);
          } catch (error) {
            results[index] = {
              file,
              error: error instanceof Error ? error.message : "Unable to upload attachments"
            };
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, uploadable.length) }, () => worker())
      );

      for (const result of results) {
        if (!result) continue;
        if ("error" in result) {
          failures.push(result);
        } else {
          successes.push(result);
        }
      }

      if (successes.length) {
        setPendingAttachments((current) => [...current, ...successes]);
      }

      if (failures.length) {
        failures.sort((a, b) => queued.indexOf(a.file) - queued.indexOf(b.file));
        failedUploadsRef.current = failures.filter((failure) => failure.file.size > 0);
        input.onError(describeFailures(failures, queued.length));
      }
    } catch (error) {
      failedUploadsRef.current = queued.map((file) => ({
        file,
        error: error instanceof Error ? error.message : "Unable to upload attachments"
      }));
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
