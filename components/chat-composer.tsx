"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  ChevronDown,
  FileText,
  LoaderCircle,
  Paperclip,
  Square,
  Users,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { ContextGauge } from "@/components/context-gauge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  MessageAttachment,
  ProviderProfileSummary
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
  personas: Array<{ id: string; name: string }>;
  personaId: string | null;
  onPersonaChange: (personaId: string | null) => void | Promise<void>;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
  usedTokens: number | null;
  modelContextLimit: number;
  compactionThreshold: number;
  hasMessages: boolean;
  canStop: boolean;
  isStopPending: boolean;
  onStop: () => void | Promise<void>;
};

function CustomDropdown<T extends { id: string; name: string }>({
  items,
  selectedId,
  onSelect,
  icon: Icon,
  placeholder,
  disabled,
  accentColor = "cyan"
}: {
  items: T[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  icon: React.ElementType;
  placeholder: string;
  disabled?: boolean;
  accentColor?: "cyan" | "violet";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedItem = items.find((item) => item.id === selectedId);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const accentClasses = {
    cyan: isOpen ? "text-cyan-400 bg-cyan-400/10" : "text-cyan-400/70 hover:text-cyan-400",
    violet: isOpen ? "text-violet-400 bg-violet-400/10" : "text-violet-400/70 hover:text-violet-400"
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all duration-200 hover:bg-white/5",
          accentClasses[accentColor as keyof typeof accentClasses],
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {selectedItem && (
          <div className="flex flex-col items-start leading-tight">
            <span className="max-w-[80px] truncate text-[11px] font-bold sm:max-w-[140px]">
              {selectedItem.name}
            </span>
            {"model" in selectedItem && (
              <span className="text-[9px] opacity-60 truncate max-w-[80px] sm:max-w-[140px] font-medium">
                {(selectedItem as any).model}
              </span>
            )}
          </div>
        )}
        <ChevronDown className={cn("h-3 w-3 opacity-40 transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full left-0 z-50 mb-2 min-w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
              {placeholder && (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(null);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/5",
                    !selectedId ? "text-white font-medium" : "text-white/50"
                  )}
                >
                  {placeholder}
                </button>
              )}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5",
                    selectedId === item.id ? "bg-white/10" : ""
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className={cn(
                      "text-[12.5px] font-semibold truncate",
                      selectedId === item.id ? "text-white" : "text-white/80"
                    )}>
                      {item.name}
                    </span>
                    {"model" in item && (
                      <span className="text-[10px] text-white/40 truncate font-medium">
                        {(item as any).model}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
  personas,
  personaId,
  onPersonaChange,
  textareaRef,
  className,
  usedTokens,
  modelContextLimit,
  compactionThreshold,
  hasMessages,
  canStop,
  isStopPending,
  onStop
}: ChatComposerProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const isSubmitDisabled =
    isSending || isUploadingAttachments || (!input.trim() && pendingAttachments.length === 0);
  const showStopButton = canStop && !isUploadingAttachments;

  // For the model selector, we want to show the profile name prominently
  const displayModels = providerProfiles.map(p => ({
    id: p.id,
    name: p.name, // Show profile name as primary
    model: p.model
  }));

  return (
    <div
      className={cn(
        "relative rounded-[22px] sm:rounded-[26px] border border-white/10 bg-zinc-900/70 backdrop-blur-2xl p-1.5 sm:p-2 shadow-[0_0_40px_rgba(0,0,0,0.5)] transition-all duration-500 focus-within:border-[var(--accent)]/30 focus-within:shadow-[0_0_50px_rgba(0,0,0,0.6),0_0_20px_var(--accent-soft)]",
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
      
      <AnimatePresence initial={false}>
        {pendingAttachments.length ? (
          <motion.div 
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="flex flex-wrap gap-2 px-1.5 pt-1 overflow-hidden"
          >
            {pendingAttachments.map((attachment) => (
              <motion.div
                key={attachment.id}
                layout
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5 pr-2.5 text-sm text-white/80 backdrop-blur-md"
              >
                {attachment.kind === "image" ? (
                  <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-white/10">
                    <Image
                      src={`/api/attachments/${attachment.id}`}
                      alt={attachment.filename}
                      fill
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/60">
                    <FileText className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 max-w-[120px]">
                  <div className="truncate text-[13px] font-medium text-white/90">{attachment.filename}</div>
                  <div className="truncate text-[10px] uppercase tracking-wider text-white/40">{attachment.mimeType.split('/')[1] || attachment.mimeType}</div>
                </div>
                <button
                  type="button"
                  className="ml-1 rounded-full p-1 text-white/30 transition-all duration-200 hover:bg-white/10 hover:text-white/80"
                  onClick={() => void onRemovePendingAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.filename}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex w-full items-center gap-2 pb-1 pr-1.5">
        <div className="flex-1 min-w-0">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder="Ask anything..."
            className="max-h-[300px] min-h-[52px] w-full resize-none border-0 bg-transparent px-4 py-3.5 text-[15px] text-[var(--text)] focus-visible:ring-0 focus:outline-none scrollbar-thin placeholder:text-white/20 caret-[var(--accent)]"
            style={{ height: "auto" }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSubmit();
              }
            }}
          />
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => void (showStopButton ? onStop() : onSubmit())}
          disabled={showStopButton ? isStopPending : isSubmitDisabled}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 shrink-0",
            showStopButton
              ? isStopPending
                ? "bg-white/5 text-white/20"
                : "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]"
              : !isSubmitDisabled
                ? "bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)]"
                : "bg-white/5 text-white/20"
          )}
          aria-label={showStopButton ? "Stop response" : "Send message"}
        >
          {showStopButton ? (
            <Square className="h-4 w-4 fill-current" />
          ) : isSending || isUploadingAttachments ? (
            <LoaderCircle className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowUp className="h-5 w-5 stroke-[2.5px]" />
          )}
        </motion.button>
      </div>


      {showVisionWarning ? (
        <motion.div 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-2 mb-2 flex items-center gap-2 rounded-2xl border border-amber-500/10 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/70"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Selected model might not support vision input.
          </span>
        </motion.div>
      ) : null}

      <div className="flex items-center justify-between px-1.5 pb-1 pt-1.5 border-t border-white/5">
        <div className="flex items-center gap-0.5">
          <button
            className="p-2 text-white/30 hover:text-white/60 transition-all duration-200 rounded-xl hover:bg-white/5 shrink-0"
            aria-label="Attach files"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4.5 w-4.5" />
          </button>

          <div className="h-4 w-px bg-white/5 mx-1" />

          <CustomDropdown
            items={displayModels}
            selectedId={providerProfileId}
            onSelect={(id) => id && void onProviderProfileChange(id)}
            icon={Bot}
            placeholder=""
            accentColor="cyan"
            disabled={isSending}
          />

          <CustomDropdown
            items={personas}
            selectedId={personaId}
            onSelect={(id) => void onPersonaChange(id)}
            icon={Users}
            placeholder="None"
            accentColor="violet"
            disabled={isSending}
          />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {hasMessages && (
            <div className="flex items-center gap-2 px-1">
              <span className="text-[10px] text-white/20 font-medium tracking-wider uppercase hidden md:inline-block">Context</span>
              <ContextGauge
                usedTokens={usedTokens}
                usableLimit={Math.floor(modelContextLimit * compactionThreshold)}
                maxLimit={modelContextLimit}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
