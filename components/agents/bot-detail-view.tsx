"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Eraser,
  LoaderCircle,
  PanelRight,
  Pencil,
  RotateCcw,
  Square,
  Trash2
} from "lucide-react";
import type { BotWorkspaceNode } from "@/lib/bot-sandbox";

import { BotAvatar } from "@/components/agents/bot-avatar";
import { BotStatusChip } from "@/components/agents/bot-status";
import { BotFormModal } from "@/components/agents/bot-form-modal";
import { BotSkillModal } from "@/components/agents/bot-skill-modal";
import { BotRunList, isActiveBotRun } from "@/components/agents/bot-runs";
import { BotWorkspaceFiles } from "@/components/agents/bot-workspace-files";
import { ChatView } from "@/components/chat-view";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/settings/badge";
import { addGlobalWsListener } from "@/lib/ws-client";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import type { Automation, BotRun, BotSummary, Skill, UserMemory } from "@/lib/types";

function scheduleSummary(automation: Automation) {
  if (automation.scheduleKind === "interval" && automation.intervalMinutes) {
    return `Every ${automation.intervalMinutes} min`;
  }
  if (automation.calendarFrequency === "weekly") {
    return `Weekly at ${automation.timeOfDay ?? "--:--"}`;
  }
  return `Daily at ${automation.timeOfDay ?? "--:--"}`;
}

const headerControlButton =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 text-sm font-medium transition-colors";

const BOT_SUBTITLE_DESCRIPTION_MAX_CHARS = 90;
const MAX_VISIBLE_RUNS = 30;

function upsertRun(current: BotRun[], run: BotRun) {
  const next = [run, ...current.filter((entry) => entry.id !== run.id)];
  next.sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
  return next.slice(0, MAX_VISIBLE_RUNS);
}

function buildBotSubtitle(bot: BotSummary) {
  const description = bot.description.trim();
  const shortDescription =
    description.length > BOT_SUBTITLE_DESCRIPTION_MAX_CHARS
      ? `${description.slice(0, BOT_SUBTITLE_DESCRIPTION_MAX_CHARS).trimEnd()}…`
      : description || "Specialist bot";
  return [bot.title.trim(), shortDescription].filter(Boolean).join(" · ");
}

function PanelSection({
  title,
  action,
  defaultOpen = false,
  children
}: {
  title: string;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-white/4 last:border-b-0">
      <div className="flex w-full items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex flex-1 items-center gap-1.5 text-left"
          aria-expanded={isOpen}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-white/30 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
          <span className="text-[0.95rem] font-semibold text-[#f4f4f5]">{title}</span>
        </button>
        {action}
      </div>
      {isOpen ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

export function BotDetailView({
  bot: initialBot,
  systemPrompt,
  conversationPayload,
  routines,
  runs: initialRuns,
  botNames: initialBotNames
}: {
  bot: BotSummary;
  systemPrompt: string;
  conversationPayload: ConversationViewPayload;
  routines: Automation[];
  runs: BotRun[];
  botNames: Record<string, string>;
}) {
  const router = useRouter();
  const [bot, setBot] = useState(initialBot);
  const [runs, setRuns] = useState(initialRuns);
  const [botNames, setBotNames] = useState(initialBotNames);
  const [stoppingRunIds, setStoppingRunIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isStoppingAll, setIsStoppingAll] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [isClearOpen, setIsClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [workspace, setWorkspace] = useState<{
    tree: BotWorkspaceNode;
    sharedTree: BotWorkspaceNode;
    version: number;
  } | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [botMemories, setBotMemories] = useState<UserMemory[] | null>(null);
  const [botMemoriesError, setBotMemoriesError] = useState<string | null>(null);
  const [memoryDeleteTarget, setMemoryDeleteTarget] = useState<UserMemory | null>(null);
  const [botSkills, setBotSkills] = useState<Skill[] | null>(null);
  const [botSkillsError, setBotSkillsError] = useState<string | null>(null);
  const [skillEditTarget, setSkillEditTarget] = useState<Skill | null>(null);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [skillDeleteTarget, setSkillDeleteTarget] = useState<Skill | null>(null);
  const resetNoticeHandle = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const workspaceRefreshTimerRef = useRef<number | null>(null);

  const refreshBot = useCallback(async () => {
    try {
      const response = await fetch(`/api/bots/${initialBot.id}`);
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { bot?: BotSummary; runs?: BotRun[] };
      if (payload.bot) {
        setBot(payload.bot);
      }
      if (Array.isArray(payload.runs)) {
        setRuns(payload.runs);
      }
    } catch {
      return;
    }
  }, [initialBot.id]);

  const loadWorkspace = useCallback(async () => {
    try {
      const response = await fetch(`/api/bots/${initialBot.id}/workspace`);
      if (!response.ok) {
        setWorkspaceError("Unable to load workspace files");
        return;
      }
      const payload = (await response.json()) as { tree?: BotWorkspaceNode; sharedTree?: BotWorkspaceNode };
      if (!payload.tree || !payload.sharedTree) {
        setWorkspaceError("Unable to load workspace files");
        return;
      }
      const { tree, sharedTree } = payload;
      setWorkspace((prev) => ({ tree, sharedTree, version: (prev?.version ?? 0) + 1 }));
      setWorkspaceError(null);
    } catch {
      setWorkspaceError("Unable to load workspace files");
    }
  }, [initialBot.id]);

  const loadMemories = useCallback(async () => {
    try {
      const response = await fetch(`/api/bots/${initialBot.id}/memories`);
      if (!response.ok) {
        setBotMemoriesError("Unable to load memories");
        return;
      }
      const payload = (await response.json()) as { memories?: UserMemory[] };
      setBotMemories(Array.isArray(payload.memories) ? payload.memories : []);
      setBotMemoriesError(null);
    } catch {
      setBotMemoriesError("Unable to load memories");
    }
  }, [initialBot.id]);

  const loadSkills = useCallback(async () => {
    try {
      const response = await fetch(`/api/bots/${initialBot.id}/skills`);
      if (!response.ok) {
        setBotSkillsError("Unable to load skills");
        return;
      }
      const payload = (await response.json()) as { skills?: Skill[] };
      setBotSkills(Array.isArray(payload.skills) ? payload.skills : []);
      setBotSkillsError(null);
    } catch {
      setBotSkillsError("Unable to load skills");
    }
  }, [initialBot.id]);

  useEffect(() => {
    setBot(initialBot);
  }, [initialBot]);

  useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);

  useEffect(() => {
    if (!bot.unread) return;
    const markRead = () => {
      if (document.visibilityState !== "visible") return;
      void fetch(`/api/bots/${bot.id}/read`, { method: "POST" }).catch(() => {});
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [bot.id, bot.unread]);

  useEffect(() => {
    void loadWorkspace();
    void loadMemories();
    void loadSkills();
    const noticeHandle = resetNoticeHandle;
    const refreshHandle = refreshTimerRef;
    return () => {
      if (noticeHandle.current !== null) {
        window.clearTimeout(noticeHandle.current);
      }
      if (refreshHandle.current !== null) {
        window.clearTimeout(refreshHandle.current);
      }
    };
  }, [loadMemories, loadSkills, loadWorkspace]);

  useEffect(() => {
    const workspaceRefreshHandle = workspaceRefreshTimerRef;
    const scheduleWorkspaceReload = () => {
      if (workspaceRefreshHandle.current !== null) {
        return;
      }
      workspaceRefreshHandle.current = window.setTimeout(() => {
        workspaceRefreshHandle.current = null;
        void loadWorkspace();
      }, 250);
    };

    const removeListener = addGlobalWsListener((msg) => {
      if (msg.type === "bot_updated" || msg.type === "bot_run_updated") {
        scheduleWorkspaceReload();
      }
      if (msg.type === "bot_updated") {
        setBotNames((current) =>
          current[msg.bot.id] === msg.bot.name ? current : { ...current, [msg.bot.id]: msg.bot.name }
        );
        if (msg.bot.id === initialBot.id) setBot(msg.bot);
        return;
      }
      if (msg.type === "bot_deleted" && msg.botId === initialBot.id) {
        router.push("/agents");
        return;
      }
      if (msg.type === "bot_run_updated" && msg.run.requestedByBotId === initialBot.id) {
        setRuns((current) => upsertRun(current, msg.run));
        return;
      }
      if (msg.type === "bot_run_updated" && msg.run.botId === initialBot.id) {
        setRuns((current) => upsertRun(current, msg.run));
        if (refreshTimerRef.current !== null) {
          return;
        }
        refreshTimerRef.current = window.setTimeout(() => {
          refreshTimerRef.current = null;
          void refreshBot();
          void loadSkills();
        }, 250);
      }
    }, {
      onReconnect() {
        void refreshBot();
        void loadSkills();
        void loadWorkspace();
      }
    });

    return () => {
      removeListener();
      if (workspaceRefreshHandle.current !== null) {
        window.clearTimeout(workspaceRefreshHandle.current);
        workspaceRefreshHandle.current = null;
      }
    };
  }, [initialBot.id, loadSkills, loadWorkspace, refreshBot, router]);

  async function handleStopRun(run: BotRun) {
    setRunsError(null);
    setStoppingRunIds((current) => new Set(current).add(run.id));
    try {
      const response = await fetch(`/api/bots/${bot.id}/runs/${run.id}/stop`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { run?: BotRun; error?: string } | null;
      if (!response.ok || !payload?.run) {
        setRunsError(payload?.error ?? "Could not stop the run");
        return;
      }
      setRuns((current) => upsertRun(current, payload.run as BotRun));
    } catch {
      setRunsError("Could not stop the run");
    } finally {
      setStoppingRunIds((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
    }
  }

  async function handleStopAll() {
    setRunsError(null);
    setIsStoppingAll(true);
    try {
      const response = await fetch(`/api/bots/${bot.id}/stop`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { bot?: BotSummary; error?: string } | null;
      if (!response.ok || !payload?.bot) {
        setRunsError(payload?.error ?? "Could not stop this bot's work");
        return;
      }
      setBot(payload.bot);
      await refreshBot();
    } catch {
      setRunsError("Could not stop this bot's work");
    } finally {
      setIsStoppingAll(false);
    }
  }

  async function handleEdit(values: {
    name: string;
    title: string;
    description: string;
    systemPrompt: string;
    providerProfileId: string | null;
  }) {
    try {
      const body: Record<string, string | null> = {
        name: values.name,
        title: values.title,
        description: values.description
      };

      if (values.systemPrompt !== systemPrompt) {
        body.systemPrompt = values.systemPrompt;
      }

      if (values.providerProfileId !== bot.providerProfileId) {
        body.providerProfileId = values.providerProfileId;
      }

      const response = await fetch(`/api/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => null)) as { bot?: BotSummary; error?: string } | null;

      if (!response.ok || !payload?.bot) {
        return payload?.error ?? "Unable to save bot";
      }

      setBot(payload.bot);
      router.refresh();
      return null;
    } catch {
      return "Unable to save bot";
    }
  }

  async function handleReset() {
    setIsResetOpen(false);
    setIsResetting(true);
    setResetNotice(null);

    try {
      const response = await fetch(`/api/bots/${bot.id}/reset-browser-session`, { method: "POST" });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        setResetNotice(failure?.error ?? "Could not reset the browser session");
      } else {
        setResetNotice("Browser session reset");
        window.setTimeout(() => setResetNotice(null), 2500);
      }
    } catch {
      setResetNotice("Could not reset the browser session");
    } finally {
      setIsResetting(false);
    }
  }

  async function handleClearContext() {
    setIsClearOpen(false);
    setIsClearing(true);
    setClearNotice(null);

    try {
      const response = await fetch(`/api/bots/${bot.id}/clear-context`, { method: "POST" });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        setClearNotice(failure?.error ?? "Could not clear the conversation");
      } else {
        setClearNotice("Conversation cleared");
        window.setTimeout(() => setClearNotice(null), 2500);
        setShowPanel(false);
        router.refresh();
      }
    } catch {
      setClearNotice("Could not clear the conversation");
    } finally {
      setIsClearing(false);
    }
  }

  async function handleMemoryDelete() {
    const target = memoryDeleteTarget;
    setMemoryDeleteTarget(null);
    if (!target) {
      return;
    }

    try {
      const response = await fetch(
        `/api/bots/${bot.id}/memories?memoryId=${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        setBotMemoriesError("Could not delete memory");
        return;
      }
      await loadMemories();
    } catch {
      setBotMemoriesError("Could not delete memory");
    }
  }

  async function handleSkillDelete() {
    const target = skillDeleteTarget;
    setSkillDeleteTarget(null);
    if (!target) {
      return;
    }

    try {
      const response = await fetch(
        `/api/bots/${bot.id}/skills/${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        setBotSkillsError("Could not delete skill");
        return;
      }
      await loadSkills();
    } catch {
      setBotSkillsError("Could not delete skill");
    }
  }

  async function handleDelete() {
    setIsDeleteOpen(false);

    try {
      const response = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        setResetNotice(failure?.error ?? "Could not delete bot");
        return;
      }
      router.push("/agents");
    } catch {
      setResetNotice("Could not delete bot");
    }
  }

  const activeRunCount = runs.filter(isActiveBotRun).length;
  const hasActiveWork = activeRunCount > 0 || bot.status !== "idle";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/4 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <BotAvatar seed={bot.avatarSeed} size={40} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-[var(--text)]">{bot.name}</span>
                <BotStatusChip status={bot.status} waitingForInput={bot.waitingForInput} />
              </div>
              <div className={`${controlsOpen ? "block" : "hidden"} truncate text-xs text-[var(--muted)] md:block`}>
                {buildBotSubtitle(bot)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setControlsOpen((prev) => !prev)}
              aria-expanded={controlsOpen}
              aria-label={controlsOpen ? "Hide bot controls" : "Show bot controls"}
              className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-white/[0.03] text-[#cbd5e1] transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white md:hidden"
            >
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform duration-200 ${controlsOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>
          <div className={`${controlsOpen ? "flex" : "hidden"} flex-wrap items-center justify-end gap-2 md:flex`}>
            <button
              type="button"
              onClick={() => setShowPanel((prev) => !prev)}
              aria-pressed={showPanel}
              className={`${headerControlButton} ${
                showPanel
                  ? "border-white/25 bg-white/[0.08] text-white"
                  : "text-[#cbd5e1] hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <PanelRight className={`h-3.5 w-3.5 transition-transform duration-200 ${showPanel ? "scale-95" : ""}`} />
              <span className="lg:hidden">{showPanel ? "Chat" : "Details"}</span>
              <span className="hidden lg:inline">{showPanel ? "Hide details" : "Details"}</span>
              {!showPanel && activeRunCount > 0 ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/10 px-1 text-[10px] font-semibold text-[#f4f4f5]">
                  {activeRunCount}
                  <span className="sr-only">{` active run${activeRunCount === 1 ? "" : "s"}`}</span>
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setIsEditOpen(true)}
              className={`${headerControlButton} text-[#cbd5e1] hover:border-white/20 hover:bg-white/[0.05] hover:text-white`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            {!bot.isChief ? (
              <button
                type="button"
                onClick={() => setIsDeleteOpen(true)}
                className={`${headerControlButton} text-red-300/80 hover:border-red-500/30 hover:bg-red-500/[0.08] hover:text-red-200`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={`${showPanel ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col`}>
          <ChatView
            payload={conversationPayload}
            retainEmptyConversation
            hideConversationHeader
          />
        </div>

        <AnimatePresence>
          {showPanel ? (
            <motion.aside
              key="bot-details-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto border-t border-white/4 bg-[#101012] md:max-lg:pt-12 lg:w-[320px] lg:border-l lg:border-t-0"
              aria-label="Bot details"
            >
          <PanelSection
            title="Runs"
            defaultOpen
            action={
              hasActiveWork ? (
                <button
                  type="button"
                  onClick={() => void handleStopAll()}
                  disabled={isStoppingAll}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-[#cbd5e1] transition-colors hover:border-red-500/30 hover:bg-red-500/[0.08] hover:text-red-200 disabled:cursor-not-allowed disabled:text-[#71717a]"
                >
                  {isStoppingAll ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                  )}
                  Stop all
                </button>
              ) : null
            }
          >
            <p className="text-xs leading-5 text-[var(--muted)]">
              Recent runs of this bot and the work it handed to teammates. Stopping a run also stops
              what it handed off.
            </p>
            {runsError ? <p className="mt-2 text-xs text-red-200">{runsError}</p> : null}
            <div className="mt-3">
              {runs.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  No runs yet. Messages, hand-offs, and routines appear here.
                </p>
              ) : (
                <BotRunList
                  botId={bot.id}
                  runs={runs}
                  botNames={botNames}
                  stoppingRunIds={stoppingRunIds}
                  onStopAction={(run) => void handleStopRun(run)}
                />
              )}
            </div>
          </PanelSection>

          <PanelSection title="Conversation">
            <p className="text-xs leading-5 text-[var(--muted)]">
              Clear this bot&apos;s thread and start fresh. Its files, skills, memories, and browser
              session are kept.
            </p>
            {clearNotice ? (
              <p className="mt-2 text-xs text-[var(--muted)]">{clearNotice}</p>
            ) : null}
            <button
              type="button"
              onClick={() => setIsClearOpen(true)}
              disabled={isClearing}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-[#cbd5e1] transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:text-[#71717a]"
            >
              {isClearing ? (
                <LoaderCircle className="h-3 w-3 animate-spin" />
              ) : (
                <Eraser className="h-3 w-3" />
              )}
              {isClearing ? "Clearing…" : "Clear conversation"}
            </button>
          </PanelSection>

          <PanelSection title="Workspace">
            <p className="text-xs leading-5 text-[var(--muted)]">
              This bot keeps its files in its own workspace. Every bot on your team can use the shared
              folder. Open a file to preview or download it.
            </p>
            <div className="mt-3">
              {workspaceError ? (
                <div className="text-xs text-red-200">{workspaceError}</div>
              ) : workspace === null ? (
                <div className="text-xs text-[var(--muted)]">Loading files…</div>
              ) : (
                <BotWorkspaceFiles
                  botId={bot.id}
                  botName={bot.name}
                  tree={workspace.tree}
                  sharedTree={workspace.sharedTree}
                  version={workspace.version}
                />
              )}
            </div>
          </PanelSection>

          <PanelSection
            title="Skills"
            action={
              <button
                type="button"
                onClick={() => {
                  setSkillEditTarget(null);
                  setIsSkillModalOpen(true);
                }}
                className="shrink-0 rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-[#cbd5e1] transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
              >
                Add skill
              </button>
            }
          >
            <p className="text-xs leading-5 text-[var(--muted)]">
              Skills this bot keeps in its workspace. It can save skills itself, and you can add or edit them here.
            </p>
            <div className="mt-3">
              {botSkillsError ? (
                <div className="text-xs text-red-200">{botSkillsError}</div>
              ) : botSkills === null ? (
                <div className="text-xs text-[var(--muted)]">Loading skills…</div>
              ) : botSkills.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  No skills yet. This bot saves skills it creates here, and you can add your own.
                </p>
              ) : (
                <ul className="divide-y divide-white/4 rounded-xl border border-white/6 bg-white/[0.02]">
                  {botSkills.map((skill) => (
                    <li key={skill.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-[#f4f4f5]">{skill.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{skill.description}</span>
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSkillEditTarget(skill);
                            setIsSkillModalOpen(true);
                          }}
                          aria-label={`Edit skill ${skill.name}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#52525b] transition-colors hover:bg-white/[0.06] hover:text-[#f4f4f5]"
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkillDeleteTarget(skill)}
                          aria-label={`Delete skill ${skill.name}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#52525b] transition-colors hover:bg-red-500/10 hover:text-red-300"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </PanelSection>

          <PanelSection title="Browser">
            <p className="text-xs leading-5 text-[var(--muted)]">
              This bot browses the web in its own dedicated browser session, with its own cookies and
              logins.
            </p>
            {resetNotice ? (
              <p className="mt-2 text-xs text-[var(--muted)]">{resetNotice}</p>
            ) : null}
            <button
              type="button"
              onClick={() => setIsResetOpen(true)}
              disabled={isResetting}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-[#cbd5e1] transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:text-[#71717a]"
            >
              {isResetting ? (
                <LoaderCircle className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Reset browser session
            </button>
          </PanelSection>

          <PanelSection title="Memories">
            <p className="text-xs leading-5 text-[var(--muted)]">
              Private to this bot. Facts about the user come from the shared account memory.
            </p>
            <div className="mt-3">
              {botMemoriesError ? (
                <div className="text-xs text-red-200">{botMemoriesError}</div>
              ) : botMemories === null ? (
                <div className="text-xs text-[var(--muted)]">Loading memories…</div>
              ) : botMemories.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  No memories yet. This bot saves what it learns to its own pool.
                </p>
              ) : (
                <ul className="divide-y divide-white/4 rounded-xl border border-white/6 bg-white/[0.02]">
                  {botMemories.map((memory) => (
                    <li key={memory.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-xs leading-5 text-[#f4f4f5]">
                          {memory.content}
                        </span>
                        <span className="mt-1 flex">
                          <Badge variant="violet">{memory.category}</Badge>
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setMemoryDeleteTarget(memory)}
                        aria-label="Delete memory"
                        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#52525b] transition-colors hover:bg-red-500/10 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </PanelSection>

          <PanelSection
            title="Routines"
            action={
              <Link
                href="/settings/automations"
                className="shrink-0 rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-[#cbd5e1] transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
              >
                Add routine
              </Link>
            }
          >
            {routines.length === 0 ? (
              <p className="text-xs leading-5 text-[var(--muted)]">
                No routines bound to this bot yet. Bind an automation to have it run in this bot&apos;s thread.
              </p>
            ) : (
              <ul className="space-y-2">
                {routines.map((routine) => (
                  <li key={routine.id}>
                    <Link
                      href={`/automations/${routine.id}`}
                      className="block rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="truncate text-xs font-medium text-[#f4f4f5]">{routine.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#71717a]">
                        <span>{scheduleSummary(routine)}</span>
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${routine.enabled ? "bg-emerald-400" : "bg-[#52525b]"}`}
                          aria-hidden="true"
                        />
                        <span>{routine.enabled ? "Enabled" : "Paused"}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>

          {bot.isChief ? null : (
            <div className="px-4 py-4">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start gap-1.5 px-3 text-sm text-red-300/80 hover:bg-red-500/[0.06] hover:text-red-200"
                onClick={() => setIsDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete bot
              </Button>
            </div>
          )}
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      <BotFormModal
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        bot={bot}
        currentSystemPrompt={systemPrompt}
        submitLabel="Save changes"
        title="Edit bot"
        description="Update how this bot presents itself and works."
        providerProfiles={conversationPayload.providerProfiles ?? []}
        defaultProviderProfileId={conversationPayload.defaultProviderProfileId ?? null}
        onSubmit={handleEdit}
      />

      <ConfirmDialog
        open={isClearOpen}
        onOpenChange={setIsClearOpen}
        variant="default"
        confirmLabel="Clear"
        title="Clear conversation?"
        description={
          <>
            All messages and context in <strong className="font-medium text-[var(--text)]">{bot.name}</strong>&apos;s thread will be removed and the thread starts fresh. Any running task is stopped. Files, skills, memories, and the browser session are kept. This action cannot be undone.
          </>
        }
        onConfirm={handleClearContext}
      />

      <ConfirmDialog
        open={isResetOpen}
        onOpenChange={setIsResetOpen}
        variant="default"
        confirmLabel="Reset session"
        title="Reset browser session?"
        description={
          <>
            The dedicated browser session for <strong className="font-medium text-[var(--text)]">{bot.name}</strong> will be stopped and wiped. Workspace files are kept.
          </>
        }
        onConfirm={handleReset}
      />

      <ConfirmDialog
        open={memoryDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMemoryDeleteTarget(null);
          }
        }}
        title="Delete memory?"
        description={
          <>
            <strong className="font-medium text-[var(--text)]">{memoryDeleteTarget?.content}</strong> will be removed from this bot&apos;s private memory. This action cannot be undone.
          </>
        }
        onConfirm={handleMemoryDelete}
      />

      <BotSkillModal
        open={isSkillModalOpen}
        onOpenChange={setIsSkillModalOpen}
        botId={bot.id}
        skill={skillEditTarget}
        onSaved={loadSkills}
      />

      <ConfirmDialog
        open={skillDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSkillDeleteTarget(null);
          }
        }}
        title="Delete skill?"
        description={
          <>
            <strong className="font-medium text-[var(--text)]">{skillDeleteTarget?.name}</strong> will be removed from this bot&apos;s workspace. This action cannot be undone.
          </>
        }
        onConfirm={handleSkillDelete}
      />

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete bot?"
        description={
          <>
            <strong className="font-medium text-[var(--text)]">{bot.name}</strong> and its thread will be permanently deleted. This action cannot be undone.
          </>
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}
