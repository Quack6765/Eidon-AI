"use client";

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  Square,
  Telescope,
  Users,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { ContextGauge } from "@/components/context-gauge";
import { Textarea } from "@/components/ui/textarea";
import type { ReasoningEffort } from "@/lib/provider-catalog";
import { resolveProviderProfileCapabilities } from "@/lib/provider-profile";
import type { SpeechPhase } from "@/lib/speech/types";
import { cn } from "@/lib/utils";
import { useAutoResize } from "@/lib/use-auto-resize";
import { useIsMobile } from "@/lib/use-is-mobile";
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
  reasoningEffort: ReasoningEffort | null;
  onReasoningEffortChange: (effort: ReasoningEffort) => void | Promise<void>;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
  usedTokens: number | null;
  modelContextLimit: number;
  compactionLimit: number;
  memoriesUsed?: number | null;
  memoriesTotal?: number | null;
  hasMessages: boolean;
  canStop: boolean;
  isStopPending: boolean;
  onStop: () => void | Promise<void>;
  speechPhase: SpeechPhase;
  speechLevel: number;
  speechError: string | null;
  onStartSpeech: () => void | Promise<void>;
  onStopSpeech: () => void | Promise<void>;
  queueingEnabled?: boolean;
  isTemporary?: boolean;
  showTemporaryToggle?: boolean;
  onTemporaryChange?: (value: boolean) => void;
  isResearch?: boolean;
  onResearchChange?: (value: boolean) => void;
  compactOnMobile?: boolean;
};

function CustomDropdown<T extends { id: string; name: string }>({
  items,
  selectedId,
  onSelect,
  icon: Icon,
  placeholder,
  ariaLabel,
  disabled,
  accentColor = "cyan",
  mutedWhenEmpty = false,
  allowDeselect = false,
  onOpenChange
}: {
  items: Array<T & { badge?: string }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  icon: React.ElementType;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  accentColor?: "cyan" | "violet" | "emerald";
  mutedWhenEmpty?: boolean;
  allowDeselect?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedItem = items.find((item) => item.id === selectedId);

  const updateOpen = useCallback(
    (next: boolean) => {
      setIsOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        updateOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, updateOpen]);

  const noItems = mutedWhenEmpty && items.length === 0;
  const isDisabled = disabled || noItems;
  const isEmpty = mutedWhenEmpty && !selectedId;

  const accentClasses = {
    cyan: isOpen ? "text-cyan-400 bg-cyan-400/10" : "text-cyan-400/70 hover:text-cyan-400",
    violet: isOpen ? "text-violet-400 bg-violet-400/10" : "text-violet-400/70 hover:text-violet-400",
    emerald: isOpen ? "text-emerald-400 bg-emerald-400/10" : "text-emerald-400/70 hover:text-emerald-400"
  };

  const mutedClasses = noItems
    ? "text-white/20 cursor-not-allowed"
    : isOpen ? "text-white/50 bg-white/5" : "text-white/30 hover:text-white/50";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={isDisabled}
        aria-label={ariaLabel}
        onClick={() => { if (!isDisabled) updateOpen(!isOpen); }}
        className={cn(
          "flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all duration-200",
          !isDisabled && "hover:bg-white/5",
          isEmpty || noItems ? mutedClasses : accentClasses[accentColor as keyof typeof accentClasses],
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
        {!noItems && (
          <ChevronDown className={cn("h-3 w-3 opacity-40 transition-transform duration-200", isOpen && "rotate-180")} />
        )}
      </button>

      <AnimatePresence>
        {isOpen && !noItems && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full left-0 z-50 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-1.5 shadow-2xl"
          >
            <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
              {placeholder && (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(null);
                    updateOpen(false);
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
                    if (allowDeselect && selectedId === item.id) {
                      onSelect(null);
                    } else {
                      onSelect(item.id);
                    }
                    updateOpen(false);
                  }}
                  className={cn(
                    "w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5",
                    selectedId === item.id ? "bg-white/10" : ""
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[12.5px] font-semibold truncate whitespace-nowrap",
                      selectedId === item.id ? "text-white" : "text-white/80"
                    )}>
                      {item.name}
                    </span>
                    {selectedId === item.id && allowDeselect && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                    )}
                    {"model" in item && (
                      <span className="text-[10px] text-white/40 truncate font-medium ml-auto">
                        {(item as any).model}
                      </span>
                    )}
                    {item.badge ? (
                      <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/45">
                        {item.badge}
                      </span>
                    ) : null}
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

function formatReasoningEffortLabel(effort: ReasoningEffort): string {
  if (effort === "none") {
    return "Disabled";
  }
  return effort.charAt(0).toUpperCase() + effort.slice(1);
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
  reasoningEffort,
  onReasoningEffortChange,
  textareaRef,
  className,
  usedTokens,
  modelContextLimit,
  compactionLimit,
  memoriesUsed = null,
  memoriesTotal = null,
  hasMessages,
  canStop,
  isStopPending,
  onStop,
  speechPhase,
  speechLevel,
  speechError,
  onStartSpeech,
  onStopSpeech,
  queueingEnabled = false,
  isTemporary = false,
  showTemporaryToggle = false,
  onTemporaryChange,
  isResearch = false,
  onResearchChange,
  compactOnMobile = false,
}: ChatComposerProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const { height: textareaHeight } = useAutoResize({
    ref: textareaRef as React.RefObject<HTMLTextAreaElement | null>,
    value: input,
    minHeight: 44
  });
  const textareaWraps = textareaHeight > 52;
  const [layoutStacked, setLayoutStacked] = useState(false);
  const isExpanded = layoutStacked || textareaWraps;
  const isMobile = useIsMobile();
  const [toolbarOverflow, setToolbarOverflow] = useState<"hidden" | "visible">("visible");
  const [mobilePanel, setMobilePanel] = useState<"closed" | "tools" | "models" | "personas" | "efforts">("closed");
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (input.length === 0) {
      setLayoutStacked(false);
    } else if (textareaWraps) {
      setLayoutStacked(true);
    }
  }, [input.length, textareaWraps]);

  useEffect(() => {
    if (mobilePanel === "closed") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!mobileMenuRef.current?.contains(event.target as Node)) {
        setMobilePanel("closed");
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobilePanel("closed");
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobilePanel]);

  const hasTextDraft = input.trim().length > 0;
  const canQueueDraft = queueingEnabled && hasTextDraft;
  const canImmediateDraft = !queueingEnabled && (hasTextDraft || pendingAttachments.length > 0);
  const composerPlaceholder = queueingEnabled ? "Queue a message" : "Message Eidon";
  const showStopButton = canStop && !isUploadingAttachments;
  const isSubmitDisabled =
    !mounted ||
    isUploadingAttachments ||
    speechPhase === "listening" ||
    speechPhase === "transcribing" ||
    speechPhase === "cleaning" ||
    (!showStopButton && !canQueueDraft && !canImmediateDraft) ||
    (!queueingEnabled && isSending);
  const showContextUsage = hasMessages && usedTokens !== null;
  const isSpeechActive =
    speechPhase === "listening" || speechPhase === "transcribing" || speechPhase === "cleaning";
  const speechLevelWidth = Math.max(8, Math.round(speechLevel * 100));
  const speechControlsDisabled = !mounted || isSending || isUploadingAttachments || isSpeechActive;
  const showQueueAndStop = showStopButton && canQueueDraft;
  const primaryActionStops = showStopButton && !canQueueDraft;
  const hideIdleSubmitOnMobile =
    !showStopButton &&
    !hasTextDraft &&
    pendingAttachments.length === 0 &&
    !isSending &&
    !isUploadingAttachments;

  // For the model selector, we want to show the profile name prominently
  const displayModels = providerProfiles.map(p => ({
    id: p.id,
    name: p.name, // Show profile name as primary
    model: p.model
  }));
  const selectedModel = displayModels.find((model) => model.id === providerProfileId) ?? null;
  const selectedPersona = personas.find((persona) => persona.id === personaId) ?? null;
  const selectedProviderProfile = providerProfiles.find((profile) => profile.id === providerProfileId) ?? null;
  const reasoningEffortOptions = selectedProviderProfile
    ? resolveProviderProfileCapabilities(selectedProviderProfile).reasoningEfforts
    : [];
  const providerDefaultEffort = selectedProviderProfile?.reasoningEffort ?? null;
  const effectiveReasoningEffort =
    reasoningEffort && reasoningEffortOptions.includes(reasoningEffort)
      ? reasoningEffort
      : providerDefaultEffort;
  const effortItems = reasoningEffortOptions.map((effort) => ({
    id: effort,
    name: formatReasoningEffortLabel(effort),
    badge: effort === providerDefaultEffort ? "Default" : undefined
  }));

  return (
    <div className="group/composer relative">
      {isTemporary && !showTemporaryToggle && (
        <div className="absolute -top-[31px] right-6 z-10 flex h-8 items-center">
          <div className="relative flex h-8 items-center gap-1 rounded-t-[14px] rounded-b-none border border-b-0 border-dashed border-violet-500/50 bg-zinc-900/95 px-2.5 text-[11px] font-semibold uppercase text-[var(--thinking)] backdrop-blur-md">
            <Eye className="h-3 w-3" />
            Temporary
          </div>
        </div>
      )}
      {showTemporaryToggle && (
        <div className="absolute -top-[31px] right-6 z-10 flex h-8 items-center">
          <button
            type="button"
            onClick={() => onTemporaryChange?.(!isTemporary)}
            aria-label="Temporary conversation"
            aria-pressed={isTemporary}
            style={{ fontSize: "11px" }}
            className={cn(
              "relative flex h-8 items-center gap-1 rounded-t-[14px] rounded-b-none border border-b-0 bg-zinc-900/95 px-2.5 font-semibold uppercase backdrop-blur-md transition-[border-color,color] duration-150 group-focus-within/composer:border-[var(--accent)]/30",
              isTemporary
                ? "border-dashed border-violet-500/50 text-[var(--thinking)]"
                : "border-white/10 text-white/40 hover:text-white/60"
            )}
          >
            {isTemporary ? (
              <Eye className="h-3 w-3 text-[var(--thinking)]" />
            ) : (
              <EyeOff className="h-3 w-3" />
            )}
            Temporary
          </button>
        </div>
      )}
    <div
      className={cn(
        "relative z-[1] rounded-[28px] border bg-zinc-900/95 px-2 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-[border-color,box-shadow] duration-200 focus-within:border-[var(--accent)]/30 focus-within:shadow-[0_8px_28px_rgba(0,0,0,0.45),0_0_16px_var(--accent-soft)] md:rounded-[26px] md:bg-zinc-900/85 md:backdrop-blur-md",
        isTemporary ? "border-violet-500/50 border-dashed" : "border-white/10",
        className
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
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
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5 pr-2.5 text-sm text-white/80 backdrop-blur-md min-h-[48px]"
              >
                {attachment.kind === "image" ? (
                  <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Pending attachment thumbnails are API-served user files that next/image cannot safely optimize. */}
                    <img
                      src={`/api/attachments/${attachment.id}`}
                      alt={attachment.filename}
                      className="h-full w-full object-cover"
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

      <div
        className={cn(
          "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-2 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-3 md:gap-y-1",
          isExpanded && "grid-rows-[auto_auto]"
        )}
      >
        {compactOnMobile ? (
          <div
            ref={mobileMenuRef}
            className={cn(
              "relative col-start-1 shrink-0 justify-self-start md:hidden",
              isExpanded ? "row-start-2" : "row-start-1"
            )}
          >
            <button
              type="button"
              aria-label={mobilePanel === "closed" ? "Open composer tools" : "Close composer tools"}
              aria-expanded={mobilePanel !== "closed"}
              aria-haspopup="dialog"
              disabled={!mounted}
              onClick={() => setMobilePanel((current) => current === "closed" ? "tools" : "closed")}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white/65 transition-colors duration-150 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:text-white/20"
            >
              <Plus className={cn("h-5 w-5 transition-transform duration-150", mobilePanel !== "closed" && "rotate-45")} />
            </button>

            <AnimatePresence initial={false}>
              {mobilePanel !== "closed" ? (
                <motion.div
                  role="dialog"
                  aria-label="Composer tools"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute bottom-full left-0 z-50 mb-3 w-[320px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl bg-zinc-900 p-1.5 text-white shadow-[0_12px_36px_rgba(0,0,0,0.52)]"
                >
                  {mobilePanel === "tools" ? (
                    <div className="max-h-[min(360px,45vh)] overflow-y-auto scrollbar-thin">
                      <button
                        type="button"
                        onClick={() => {
                          setMobilePanel("closed");
                          fileInputRef.current?.click();
                        }}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-white/85 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      >
                        <Paperclip className="h-4.5 w-4.5 text-white/55" />
                        <span className="font-medium">Attach files</span>
                      </button>

                      <button
                        type="button"
                        disabled={!mounted || isSending || displayModels.length === 0}
                        onClick={() => setMobilePanel("models")}
                        className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Bot className="h-4.5 w-4.5 shrink-0 text-cyan-400/75" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium text-white/55">Model</span>
                          <span className="block truncate text-sm font-medium text-white/90">
                            {selectedModel?.name ?? "No model selected"}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-white/30" />
                      </button>

                      <button
                        type="button"
                        disabled={!mounted || isSending || personas.length === 0}
                        onClick={() => setMobilePanel("personas")}
                        className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Users className="h-4.5 w-4.5 shrink-0 text-violet-400/75" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium text-white/55">Persona</span>
                          <span className="block truncate text-sm font-medium text-white/90">
                            {selectedPersona?.name ?? "No persona"}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-white/30" />
                      </button>

                      <button
                        type="button"
                        disabled={!mounted || isSending || reasoningEffortOptions.length === 0}
                        onClick={() => setMobilePanel("efforts")}
                        className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Gauge className="h-4.5 w-4.5 shrink-0 text-emerald-400/75" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium text-white/55">Effort</span>
                          <span className="block truncate text-sm font-medium text-white/90">
                            {effectiveReasoningEffort ? formatReasoningEffortLabel(effectiveReasoningEffort) : "Default provider effort"}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-white/30" />
                      </button>

                      {onResearchChange ? (
                        <button
                          type="button"
                          aria-label="Deep research"
                          aria-pressed={isResearch}
                          disabled={!mounted || isSending}
                          onClick={() => onResearchChange(!isResearch)}
                          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Telescope className={cn("h-4.5 w-4.5 shrink-0", isResearch ? "text-[var(--accent)]" : "text-white/55")} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-medium text-white/55">Deep research</span>
                            <span className="block truncate text-sm font-medium text-white/90">
                              {isResearch ? "On for the next message" : "Off"}
                            </span>
                          </span>
                          {isResearch ? <Check className="h-4 w-4 text-[var(--accent)]" /> : null}
                        </button>
                      ) : null}

                      {showContextUsage ? (
                        <div className="flex min-h-11 items-center gap-3 px-3">
                          <span className="flex-1 text-sm font-medium text-white/70">Context usage</span>
                          <ContextGauge
                            usedTokens={usedTokens}
                            usableLimit={compactionLimit}
                            maxLimit={modelContextLimit}
                            memoriesUsed={memoriesUsed}
                            memoriesTotal={memoriesTotal}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {mobilePanel === "models" ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setMobilePanel("tools")}
                        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Model
                      </button>
                      <div className="max-h-[min(300px,40vh)] overflow-y-auto scrollbar-thin">
                        {displayModels.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              void onProviderProfileChange(model.id);
                              setMobilePanel("closed");
                            }}
                            className={cn(
                              "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                              model.id === providerProfileId && "bg-cyan-400/[0.08]"
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-white/90">{model.name}</span>
                              <span className="block truncate text-xs text-white/55">{model.model}</span>
                            </span>
                            {model.id === providerProfileId ? <Check className="h-4 w-4 text-cyan-400" /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {mobilePanel === "personas" ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setMobilePanel("tools")}
                        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Persona
                      </button>
                      <div className="max-h-[min(300px,40vh)] overflow-y-auto scrollbar-thin">
                        <button
                          type="button"
                          onClick={() => {
                            void onPersonaChange(null);
                            setMobilePanel("closed");
                          }}
                          className={cn(
                            "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                            personaId === null ? "bg-violet-400/[0.08] text-white/90" : "text-white/65"
                          )}
                        >
                          <span className="flex-1 font-medium">No persona</span>
                          {personaId === null ? <Check className="h-4 w-4 text-violet-400" /> : null}
                        </button>
                        {personas.map((persona) => (
                          <button
                            key={persona.id}
                            type="button"
                            onClick={() => {
                              void onPersonaChange(persona.id);
                              setMobilePanel("closed");
                            }}
                            className={cn(
                              "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                              persona.id === personaId ? "bg-violet-400/[0.08] text-white/90" : "text-white/65"
                            )}
                          >
                            <span className="flex-1 truncate font-medium">{persona.name}</span>
                            {persona.id === personaId ? <Check className="h-4 w-4 text-violet-400" /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {mobilePanel === "efforts" ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setMobilePanel("tools")}
                        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Effort
                      </button>
                      <div className="max-h-[min(300px,40vh)] overflow-y-auto scrollbar-thin">
                        {reasoningEffortOptions.map((effort) => (
                          <button
                            key={effort}
                            type="button"
                            onClick={() => {
                              void onReasoningEffortChange(effort);
                              setMobilePanel("closed");
                            }}
                            className={cn(
                              "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                              effort === effectiveReasoningEffort ? "bg-emerald-400/[0.08] text-white/90" : "text-white/65"
                            )}
                          >
                            <span className="flex-1 truncate font-medium">{formatReasoningEffortLabel(effort)}</span>
                            {effort === providerDefaultEffort ? (
                              <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/45">
                                Default
                              </span>
                            ) : null}
                            {effort === effectiveReasoningEffort ? <Check className="h-4 w-4 text-emerald-400" /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}

        <div
          className={cn(
            "min-w-0 md:col-span-2 md:col-start-1 md:row-start-1 md:px-1 md:pb-1",
            isExpanded
              ? "col-span-3 row-start-1 px-1 pb-1"
              : "col-start-2 row-start-1"
          )}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={composerPlaceholder}
            rows={1}
            className={cn(
              "block max-h-[60vh] min-h-11 w-full resize-none rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-1.5 py-2 text-[16px] leading-relaxed text-[var(--text)] caret-[var(--accent)] transition-[background-color,border-color] duration-150 placeholder:text-center placeholder:text-white/30 focus:border-[var(--accent)]/30 focus:bg-white/[0.05] focus:shadow-none focus:outline-none focus-visible:ring-0 contrast-more:border-white/[0.14] contrast-more:bg-white/[0.08] contrast-more:placeholder:text-white/45 contrast-more:focus:bg-white/[0.12] md:px-2.5 md:text-[15px]",
              isExpanded ? "overflow-y-auto scrollbar-thin" : "overflow-hidden"
            )}
            style={{ height: `${textareaHeight}px` }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !isMobile) {
                event.preventDefault();
                if (isSpeechActive) {
                  return;
                }
                void onSubmit();
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              const imageFiles = files.filter((file) => file.type.startsWith("image/"));

              if (imageFiles.length > 0) {
                event.preventDefault();
                void onUploadFiles(imageFiles);
              }
            }}
          />
        </div>

        <div
          className={cn(
            "col-start-3 flex shrink-0 items-center justify-self-end gap-2 md:col-start-2 md:row-start-2 md:pr-1",
            isExpanded ? "row-start-2" : "row-start-1"
          )}
        >
          {!showStopButton ? <AnimatePresence mode="wait" initial={false}>
            {isSpeechActive ? (
              <motion.div
                key="active-speech-controls"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.16 }}
                className="flex items-center justify-end gap-2"
              >
                {speechPhase === "transcribing" || speechPhase === "cleaning" ? (
                  <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="flex h-9 items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 text-[11px] font-medium text-violet-100 md:h-8"
                  >
                    <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-violet-300" />
                    <span>{speechPhase === "cleaning" ? "Cleaning…" : "Transcribing…"}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex h-8 w-[80px] items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 md:w-[96px] md:px-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-[width] duration-100"
                          style={{ width: `${speechLevelWidth}%` }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Stop voice input"
                      onClick={() => void onStopSpeech()}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white transition-colors duration-200 hover:bg-red-400 md:h-8 md:w-8"
                    >
                      <Square className="h-3 w-3 fill-current" />
                    </button>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="idle-speech-controls"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.16 }}
                className="flex items-center justify-end"
              >
                <button
                  type="button"
                  aria-label="Start voice input"
                  disabled={speechControlsDisabled}
                  onClick={() => void onStartSpeech()}
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 md:h-8 md:w-8",
                    speechControlsDisabled
                      ? "bg-white/5 text-white/20 cursor-not-allowed"
                      : "bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/75"
                  )}
                >
                  <Mic className="h-4 w-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence> : null}

          {showQueueAndStop ? (
            <button
              type="button"
              aria-label="Stop response"
              onClick={() => void onStop()}
              disabled={isStopPending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/80 transition-colors duration-150 hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:text-white/20 md:h-10 md:w-10"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : null}

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() =>
              void (primaryActionStops ? onStop() : onSubmit())
            }
            disabled={primaryActionStops ? isStopPending : isSubmitDisabled}
            className={cn(
              "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform] duration-150 md:h-10 md:w-10",
              hideIdleSubmitOnMobile && "hidden md:flex",
              primaryActionStops
                ? isStopPending
                  ? "bg-white/5 text-white/20"
                  : "border border-white/12 bg-zinc-900 text-white shadow-[0_0_15px_rgba(167,139,250,0.18)]"
                : !isSubmitDisabled
                  ? "bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)]"
                  : "bg-white/5 text-white/20"
            )}
            aria-label={primaryActionStops ? "Stop response" : canQueueDraft ? "Queue follow-up" : "Send message"}
          >
            {primaryActionStops && !isStopPending ? (
              <span className="pointer-events-none absolute inset-[-3px] rounded-full border-2 border-white/10 border-t-violet-400 animate-spin" />
            ) : null}
            {primaryActionStops ? (
              <Square className="h-4 w-4 fill-current" />
            ) : isUploadingAttachments || (isSending && !canQueueDraft) ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : (
              <ArrowUp className="h-5 w-5 stroke-[2.5px]" />
            )}
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {mounted && (!compactOnMobile || !isMobile) && (
            <motion.div
              key="composer-toolbar"
              className={cn(
                "col-span-3 min-w-0",
                isExpanded ? "row-start-3" : "row-start-2",
                compactOnMobile && "hidden md:block",
                "md:col-span-1 md:col-start-1 md:row-start-2"
              )}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: toolbarOverflow }}
              onAnimationStart={() => setToolbarOverflow("hidden")}
              onAnimationComplete={() => setToolbarOverflow("visible")}
            >
              <div className="flex min-w-0 items-center justify-between px-1 pb-1">
                <div className="flex min-w-0 items-center gap-0.5">
                  <button
                    className="shrink-0 rounded-xl p-2 text-white/30 transition-all duration-200 hover:bg-white/5 hover:text-white/60"
                    aria-label="Attach files"
                    type="button"
                    disabled={!mounted}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="h-4.5 w-4.5" />
                  </button>

                  <div className="mx-1 h-4 w-px bg-white/5" />

                  <CustomDropdown
                    items={displayModels}
                    selectedId={providerProfileId}
                    onSelect={(id) => id && void onProviderProfileChange(id)}
                    icon={Bot}
                    placeholder=""
                    accentColor="cyan"
                    disabled={!mounted || isSending}
                  />

                  <CustomDropdown
                    items={personas}
                    selectedId={personaId}
                    onSelect={(id) => void onPersonaChange(id)}
                    icon={Users}
                    accentColor="violet"
                    disabled={!mounted || isSending}
                    mutedWhenEmpty
                    allowDeselect
                  />

                  <CustomDropdown
                    items={effortItems}
                    selectedId={effectiveReasoningEffort}
                    onSelect={(id) => id && void onReasoningEffortChange(id as ReasoningEffort)}
                    icon={Gauge}
                    accentColor="emerald"
                    ariaLabel="Reasoning effort"
                    disabled={!mounted || isSending || reasoningEffortOptions.length === 0}
                  />

                  {onResearchChange ? (
                    <button
                      type="button"
                      aria-label="Deep research"
                      aria-pressed={isResearch}
                      disabled={!mounted || isSending}
                      onClick={() => onResearchChange(!isResearch)}
                      className={cn(
                        "flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all duration-200",
                        !isSending && "hover:bg-white/5",
                        isResearch
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "text-white/30 hover:text-white/50",
                        (!mounted || isSending) && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <Telescope className="h-4 w-4 shrink-0" />
                      <span className="text-[11px] font-bold">Deep research</span>
                    </button>
                  ) : null}
                </div>

                {showContextUsage && (
                  <div className="flex shrink-0 items-center gap-2 px-1">
                    <span className="hidden text-[10px] font-medium uppercase tracking-wider text-white/20 lg:inline-block">Context</span>
                    <ContextGauge
                      usedTokens={usedTokens}
                      usableLimit={compactionLimit}
                      maxLimit={modelContextLimit}
                      memoriesUsed={memoriesUsed}
                      memoriesTotal={memoriesTotal}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showVisionWarning ? (
        <motion.div 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-2 mb-2 flex items-center gap-2 rounded-2xl border border-amber-500/10 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/70"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Selected model has no vision capabilities enabled.
          </span>
        </motion.div>
      ) : null}

      {speechError ? (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-2 mb-2 mt-2 rounded-2xl border border-red-400/10 bg-red-500/8 px-3 py-2 text-[11px] text-red-300"
        >
          {speechError}
        </motion.div>
      ) : null}

    </div>
    </div>
  );
}
