"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle, Pencil, Send, Trash2 } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { QueuedMessage } from "@/lib/types";

type QueuedMessageBannerProps = {
  items: QueuedMessage[];
  onEdit: (queuedMessageId: string, content: string) => void | Promise<void>;
  onDelete: (queuedMessageId: string) => void | Promise<void>;
  onSendNow: (queuedMessageId: string) => void | Promise<void>;
  className?: string;
};

const STATUS_COPY: Record<QueuedMessage["status"], string> = {
  pending: "Pending",
  processing: "Processing",
  failed: "Failed",
  cancelled: "Cancelled"
};

export function QueuedMessageBanner({
  items,
  onEdit,
  onDelete,
  onSendNow,
  className
}: QueuedMessageBannerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => left.sortOrder - right.sortOrder),
    [items]
  );

  useEffect(() => {
    if (!editingId) {
      return;
    }

    const activeItem = sortedItems.find((item) => item.id === editingId);

    if (!activeItem || activeItem.status !== "pending") {
      setEditingId(null);
      setDraftContent("");
      setIsSaving(false);
    }
  }, [editingId, sortedItems]);

  if (sortedItems.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "mb-2 rounded-xl border border-white/8 bg-zinc-950/80 shadow-[0_8px_24px_rgba(0,0,0,0.24)]",
        className
      )}
    >
      <div className="border-b border-white/6 px-3 py-2 text-sm text-white/55">
        {sortedItems.length === 1 ? "1 queued follow-up" : `${sortedItems.length} queued follow-ups`}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {sortedItems.map((item, index) => {
          const isPending = item.status === "pending";
          const isEditing = editingId === item.id;

          return (
            <div
              key={item.id}
              className={cn("px-3 py-3", index > 0 && "border-t border-white/6")}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-sm text-white/60">
                  <span className="font-medium text-white/80">{index === 0 ? "Next" : `Then ${index}`}</span>
                  <span className="text-white/35">•</span>
                  <span>{STATUS_COPY[item.status]}</span>
                </div>

                {isPending ? (
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="rounded-md border border-white/10 px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
                          onClick={() => {
                            setEditingId(null);
                            setDraftContent("");
                          }}
                          disabled={isSaving}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={async () => {
                            const nextContent = draftContent.trim();
                            if (!nextContent || isSaving) {
                              return;
                            }

                            setIsSaving(true);

                            try {
                              await onEdit(item.id, nextContent);
                              setEditingId(null);
                              setDraftContent("");
                            } finally {
                              setIsSaving(false);
                            }
                          }}
                          disabled={isSaving || !draftContent.trim()}
                        >
                          Save
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
                          onClick={() => {
                            setEditingId(item.id);
                            setDraftContent(item.content);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
                          onClick={() => void onDelete(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/15"
                          onClick={() => void onSendNow(item.id)}
                        >
                          <Send className="h-3 w-3" />
                          Send now
                        </button>
                      </>
                    )}
                  </div>
                ) : item.status === "processing" ? (
                  <div className="flex items-center gap-1 text-xs text-white/50">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Running
                  </div>
                ) : item.status === "failed" ? (
                  <div className="flex items-center gap-1 text-xs text-red-300/80">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Needs review
                  </div>
                ) : null}
              </div>

              {isEditing ? (
                <Textarea
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  className="min-h-[76px] resize-none border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--text)] focus-visible:ring-0"
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">
                  {item.content}
                </div>
              )}

              {item.status === "failed" && item.failureMessage ? (
                <div className="mt-2 text-xs text-red-300/80">{item.failureMessage}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
