"use client";

import React from "react";
import Image from "next/image";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  FileText,
  Globe,
  LayoutGrid,
  LoaderCircle,
  Paperclip,
  Pen,
  X
} from "lucide-react";

import { ContextGauge } from "@/components/context-gauge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  MessageAttachment,
  ProviderProfileSummary,
  ToolExecutionMode
} from "@/lib/types";

type ChatComposerProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  isSending: boolean;
  pendingAttachments: MessageAttachment[];
  isUploadingAttachments: boolean;
  onUploadFiles: (files: File[]) => Promise<void>;
  onRemovePendingAttachment: (attachmentId: string) => Promise<void>;
  showVisionWarning: boolean;
  providerProfiles: ProviderProfileSummary[];
  providerProfileId: string;
  onProviderProfileChange: (providerProfileId: string) => void | Promise<void>;
  toolExecutionMode: ToolExecutionMode;
  onToolExecutionModeChange: (toolExecutionMode: ToolExecutionMode) => void | Promise<void>;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
  usedTokens: number | null;
  modelContextLimit: number;
  compactionThreshold: number;
  hasMessages: boolean;
};

export function ChatComposer({
  input,
  onInputChange,
  onSubmit,
  isSending,
  pendingAttachments,
  isUploadingAttachments,
  onUploadFiles,
  onRemovePendingAttachment,
  showVisionWarning,
  providerProfiles,
  providerProfileId,
  onProviderProfileChange,
  toolExecutionMode,
  onToolExecutionModeChange,
  textareaRef,
  className,
  usedTokens,
  modelContextLimit,
  compactionThreshold,
  hasMessages
}: ChatComposerProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const isSubmitDisabled =
    isSending || isUploadingAttachments || (!input.trim() && pendingAttachments.length === 0);

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-white/6 bg-[var(--panel)] p-2 shadow-[var(--shadow)] transition-all duration-300 focus-within:border-[var(--accent)]/20 focus-within:shadow-[var(--shadow),0_0_0_3px_var(--accent-soft)]",
        className
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.json,.csv,.tsv,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.sh,.sql,.toml,.ini,.log"
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);

          try {
            await onUploadFiles(files);
          } finally {
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
          }
        }}
      />
      {pendingAttachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
          {pendingAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#1f1f23] px-2.5 py-2 text-sm text-white/80"
            >
              {attachment.kind === "image" ? (
                <Image
                  src={`/api/attachments/${attachment.id}`}
                  alt={attachment.filename}
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/8 text-white/60">
                  <FileText className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{attachment.filename}</div>
                <div className="truncate text-[11px] text-white/40">{attachment.mimeType}</div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-white/35 transition-colors duration-200 hover:bg-white/5 hover:text-white/65"
                onClick={() => void onRemovePendingAttachment(attachment.id)}
                aria-label={`Remove ${attachment.filename}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex max-h-[200px] w-full items-end gap-1 pb-0.5 pr-1">
        <div className="flex-1 rounded-lg border border-white/8 bg-[#1f1f23]">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder="Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
            className="max-h-[200px] min-h-[44px] w-full resize-none border-0 box-border bg-transparent px-3 py-2 text-base text-[var(--text)] focus-visible:ring-0 focus:outline-none scrollbar-thin rounded-lg placeholder:text-white/25 caret-[var(--accent)]"
            style={{ height: "auto" }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSubmit();
              }
            }}
          />
        </div>

        <button
          onClick={() => void onSubmit()}
          disabled={isSubmitDisabled}
          className={`mb-0.5 mr-0.5 flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-300 shrink-0 ${
            !isSubmitDisabled
              ? "bg-[var(--accent)] text-white shadow-[0_0_12px_var(--accent-glow)] hover:shadow-[0_0_20px_var(--accent-glow)] active:scale-95"
              : "bg-white/6 text-white/25"
          }`}
          aria-label="Send message"
        >
          {isSending || isUploadingAttachments ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>

      {showVisionWarning ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-amber-400/10 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            This model may not support image input. Hermes will still send the attachment and surface any provider error.
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between px-2 pt-1.5">
        <div className="flex items-center gap-1">
          <button
            className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0"
            aria-label="Attach files"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <button
            className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0"
            aria-label="Web search"
            type="button"
          >
            <Globe className="h-5 w-5" />
          </button>

          <div className="relative group">
            <button
              className="p-2 text-cyan-400/80 hover:text-cyan-400 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0 flex items-center gap-1"
              aria-label="Select model"
              type="button"
            >
              <Bot className="h-5 w-5" />
            </button>
            <select
              value={providerProfileId}
              onChange={(event) => void onProviderProfileChange(event.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={isSending || providerProfiles.length === 0}
            >
              {providerProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.model}
                </option>
              ))}
            </select>
          </div>

          <button
            className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0"
            aria-label="Prompt templates"
            type="button"
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {hasMessages && (
            <ContextGauge
              usedTokens={usedTokens}
              usableLimit={Math.round(modelContextLimit * compactionThreshold)}
              maxLimit={modelContextLimit}
            />
          )}
          <span className="text-[11px] text-white/40 select-none">Tool Selection</span>
          <div className="relative group">
            <button
              className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0 flex items-center gap-1"
              aria-label="Tool mode"
              type="button"
            >
              <Pen className="h-5 w-5" />
              <span className="text-[11px] text-white/40">
                {toolExecutionMode === "read_only" ? "Read" : "Write"}
              </span>
            </button>
            <select
              value={toolExecutionMode}
              onChange={(event) =>
                void onToolExecutionModeChange(event.target.value as ToolExecutionMode)
              }
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={isSending}
            >
              <option value="read_only">Read-Only</option>
              <option value="read_write">Read/Write</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
