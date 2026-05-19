"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Zap
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TextEditModal } from "@/components/ui/text-edit-modal";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import { createId } from "@/lib/ids";
import { DEFAULT_PROVIDER_SETTINGS } from "@/lib/constants";
import {
  applyProviderPreset,
  getMatchingProviderPresetId,
  getProviderPreset,
  PROVIDER_PRESETS
} from "@/lib/provider-presets";
import type { AppSettings, ApiMode, McpServer, ProviderPresetId, ReasoningEffort, VisionMode } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";

type SettingsPayload = AppSettings & {
  providerProfiles: Array<{
    id: string;
    name: string;
    providerKind: "openai_compatible" | "github_copilot";
    apiBaseUrl: string;
    model: string;
    apiMode: ApiMode;
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort: ReasoningEffort;
    reasoningSummaryEnabled: boolean;
    modelContextLimit: number;
    compactionThreshold: number;
    freshTailCount: number;
    tokenizerModel: "gpt-tokenizer" | "off";
    safetyMarginTokens: number;
    leafSourceTokenLimit: number;
    leafMinMessageCount: number;
    mergedMinNodeCount: number;
    mergedTargetTokens: number;
    visionMode: VisionMode;
    visionMcpServerId: string | null;
    providerPresetId: ProviderPresetId | null;
    githubAccountLogin: string | null;
    githubAccountName: string | null;
    githubTokenExpiresAt: string | null;
    githubRefreshTokenExpiresAt: string | null;
    githubConnectionStatus: "disconnected" | "connected" | "expired";
    createdAt: string;
    updatedAt: string;
    hasApiKey: boolean;
  }>;
  updatedAt: string;
};

type ProviderProfileDraft = SettingsPayload["providerProfiles"][number] & {
  apiKey: string;
  visionMode: VisionMode;
  visionMcpServerId: string | null;
  githubConnectionStatus: "disconnected" | "connected" | "expired";
};

export function ProvidersSection({ settings }: { settings: SettingsPayload }) {
  const toast = useToastState();
  const [testResult, setTestResult] = useState<{ text: string; isSuccess: boolean } | null>(null);
  const [defaultProviderProfileId, setDefaultProviderProfileId] = useState(
    settings.defaultProviderProfileId ?? settings.providerProfiles[0]?.id ?? ""
  );
  const [skillsEnabled, setSkillsEnabled] = useState(settings.skillsEnabled);
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState(
    settings.defaultProviderProfileId ?? settings.providerProfiles[0]?.id ?? ""
  );
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfileDraft[]>(
    settings.providerProfiles.map((profile) => ({
      ...profile,
      apiKey: ""
    }))
  );
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [copilotModels, setCopilotModels] = useState<Array<{ id: string; name: string; maxContextWindowTokens: number | null }>>([]);
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const maskedApiKeyValue = "••••••••";

  useEffect(() => {
    fetch("/api/mcp-servers")
      .then((res) => res.json())
      .then((data: { servers: McpServer[] }) => setMcpServers(data.servers))
      .catch(() => setMcpServers([]));
  }, []);

  const activeProviderProfile = useMemo(
    () =>
      providerProfiles.find((profile) => profile.id === selectedProviderProfileId) ??
      providerProfiles[0],
    [providerProfiles, selectedProviderProfileId]
  );
  const activeProviderPresetId = activeProviderProfile
    ? activeProviderProfile.providerPresetId ?? getMatchingProviderPresetId(activeProviderProfile)
    : null;
  const isCopilot = activeProviderProfile?.providerKind === "github_copilot";
  const isDuplicateName = activeProviderProfile
    ? providerProfiles.some(
        (p) =>
          p.id !== activeProviderProfile.id &&
          p.name.trim().toLowerCase() === activeProviderProfile.name.trim().toLowerCase()
      )
    : false;

  useEffect(() => {
    if (
      activeProviderProfile?.providerKind === "github_copilot" &&
      activeProviderProfile.githubConnectionStatus === "connected"
    ) {
      fetch(`/api/providers/github/models?providerProfileId=${activeProviderProfile.id}`)
        .then((res) => (res.ok ? res.json() : { models: [] }))
        .then((data) => setCopilotModels(data.models ?? []))
        .catch(() => setCopilotModels([]));
    } else {
      setCopilotModels([]);
    }
  }, [activeProviderProfile?.id, activeProviderProfile?.providerKind, activeProviderProfile?.githubConnectionStatus]);

  function updateActiveProviderProfile(patch: Partial<ProviderProfileDraft>) {
    if (!activeProviderProfile) {
      return;
    }

    setProviderProfiles((current) =>
      current.map((profile) =>
        profile.id === activeProviderProfile.id ? { ...profile, ...patch } : profile
      )
    );
  }

  function addProviderProfile() {
    const template = activeProviderProfile ?? providerProfiles[0];
    const nextProfileId = createId("profile");
    const nextProfile: ProviderProfileDraft = {
      ...(template ?? {
        apiBaseUrl: "https://api.openai.com/v1",
        model: "gpt-5-mini",
        apiMode: "responses" as ApiMode,
        systemPrompt: "You are an helpful AI assistant with advanced reasoning capabilities. You excel at complex problem-solving, analysis, coding, mathematics, and tasks requiring careful, step-by-step thinking.\nWhen responding:\n1. **Think step by step** - Break down complex problems into logical steps. Show your reasoning process clearly before arriving at conclusions.\n2. **Be thorough but concise** - Explore ideas deeply, but avoid unnecessary verbosity. Focus on substantive reasoning over filler text.\n3. **Verify your logic** - Double-check your reasoning for consistency, accuracy, and completeness before finalizing your answer.\n4. **Acknowledge uncertainty** - When appropriate, indicate confidence levels or alternative interpretations of the problem.\n5. **Use structured formats** - For complex answers, use numbered steps, bullet points, or sections to organize your thinking.\n6. **Adapt depth to the task** - Match the depth of your reasoning to the complexity of the question. Simple questions don't need elaborate analysis.\n7. **Use emojis sparingly** - You may use an occasional emoji when it genuinely improves tone or clarity, but keep usage infrequent and minimal. Do not use emojis in every response, avoid repeated or decorative emoji use, and never let them clutter the message.\nAlways aim to be helpful, accurate, and honest in your responses.",
        temperature: 0.7,
        maxOutputTokens: 1200,
        reasoningEffort: "medium" as ReasoningEffort,
        reasoningSummaryEnabled: true,
        modelContextLimit: 128000,
        compactionThreshold: 0.8,
        freshTailCount: 28,
        tokenizerModel: "gpt-tokenizer" as const,
        safetyMarginTokens: 1200,
        leafSourceTokenLimit: 12000,
        leafMinMessageCount: 6,
        mergedMinNodeCount: 4,
        mergedTargetTokens: 1600,
        visionMode: "native" as VisionMode,
        visionMcpServerId: null,
        providerPresetId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hasApiKey: false,
        apiKey: "",
        id: nextProfileId,
        name: ""
      }),
      id: nextProfileId,
      name: `Profile ${providerProfiles.length + 1}`,
      hasApiKey: false,
      apiKey: "",
      visionMode: template?.visionMode ?? "native" as VisionMode,
      visionMcpServerId: template?.visionMcpServerId ?? null,
      githubAccountLogin: null,
      githubAccountName: null,
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubConnectionStatus: "disconnected",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setProviderProfiles((current) => [...current, nextProfile]);
    setSelectedProviderProfileId(nextProfile.id);
    setMobileDetailVisible(true);
  }

  function applyPresetToActiveProviderProfile(presetId: ProviderPresetId) {
    if (!activeProviderProfile) {
      return;
    }

    const isAutoName = /^Profile \d+$/.test(activeProviderProfile.name);
    const patch: Partial<ProviderProfileDraft> = {
      ...applyProviderPreset(activeProviderProfile, presetId),
      providerPresetId: presetId
    };

    if (isAutoName) {
      patch.name = getProviderPreset(presetId).values.name;
    }

    updateActiveProviderProfile(patch);
  }

  function resetActiveProviderAdvancedSettings() {
    if (!activeProviderProfile) {
      return;
    }

    const patch: Partial<ProviderProfileDraft> = {
      reasoningEffort: DEFAULT_PROVIDER_SETTINGS.reasoningEffort,
      modelContextLimit: DEFAULT_PROVIDER_SETTINGS.modelContextLimit,
      compactionThreshold: DEFAULT_PROVIDER_SETTINGS.compactionThreshold,
      freshTailCount: DEFAULT_PROVIDER_SETTINGS.freshTailCount,
      visionMode: DEFAULT_PROVIDER_SETTINGS.visionMode,
      visionMcpServerId: DEFAULT_PROVIDER_SETTINGS.visionMcpServerId
    };

    if (activeProviderProfile.providerKind !== "github_copilot") {
      patch.temperature = DEFAULT_PROVIDER_SETTINGS.temperature;
      patch.maxOutputTokens = DEFAULT_PROVIDER_SETTINGS.maxOutputTokens;
      patch.reasoningSummaryEnabled = DEFAULT_PROVIDER_SETTINGS.reasoningSummaryEnabled;
      patch.apiMode = DEFAULT_PROVIDER_SETTINGS.apiMode;
      patch.tokenizerModel = DEFAULT_PROVIDER_SETTINGS.tokenizerModel;
      patch.safetyMarginTokens = DEFAULT_PROVIDER_SETTINGS.safetyMarginTokens;
      patch.leafSourceTokenLimit = DEFAULT_PROVIDER_SETTINGS.leafSourceTokenLimit;
      patch.leafMinMessageCount = DEFAULT_PROVIDER_SETTINGS.leafMinMessageCount;
      patch.mergedMinNodeCount = DEFAULT_PROVIDER_SETTINGS.mergedMinNodeCount;
      patch.mergedTargetTokens = DEFAULT_PROVIDER_SETTINGS.mergedTargetTokens;
    }

    updateActiveProviderProfile(patch);
  }

  function removeProviderProfile(profileId: string) {
    if (providerProfiles.length === 1) {
      return;
    }

    const nextProfiles = providerProfiles.filter((profile) => profile.id !== profileId);
    const fallbackProfileId =
      nextProfiles.find((profile) => profile.id === defaultProviderProfileId)?.id ??
      nextProfiles[0]?.id ??
      "";

    setProviderProfiles(nextProfiles);
    setSelectedProviderProfileId(
      selectedProviderProfileId === profileId ? fallbackProfileId : selectedProviderProfileId
    );

    if (defaultProviderProfileId === profileId) {
      setDefaultProviderProfileId(fallbackProfileId);
    }
  }

  async function buildSettingsPayload(defaultProviderProfileIdOverride?: string) {
    const nextDefaultProviderProfileId = defaultProviderProfileIdOverride ?? defaultProviderProfileId;

    return {
      ...settings,
      defaultProviderProfileId: nextDefaultProviderProfileId,
      skillsEnabled,
      providerProfiles: providerProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        providerKind: profile.providerKind ?? "openai_compatible",
        apiBaseUrl: profile.apiBaseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        apiMode: profile.apiMode,
        systemPrompt: profile.systemPrompt,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        reasoningEffort: profile.reasoningEffort,
        reasoningSummaryEnabled: profile.reasoningSummaryEnabled,
        modelContextLimit: profile.modelContextLimit,
        compactionThreshold: Math.round(profile.compactionThreshold * 100) / 100,
        freshTailCount: profile.freshTailCount,
        tokenizerModel: profile.tokenizerModel,
        safetyMarginTokens: profile.safetyMarginTokens,
        leafSourceTokenLimit: profile.leafSourceTokenLimit,
        leafMinMessageCount: profile.leafMinMessageCount,
        mergedMinNodeCount: profile.mergedMinNodeCount,
        mergedTargetTokens: profile.mergedTargetTokens,
        visionMode: profile.visionMode ?? "native",
        visionMcpServerId: profile.visionMcpServerId ?? null,
        providerPresetId: profile.providerPresetId ?? null,
        githubAccountLogin: profile.githubAccountLogin ?? null,
        githubAccountName: profile.githubAccountName ?? null,
        githubTokenExpiresAt: profile.githubTokenExpiresAt ?? null,
        githubRefreshTokenExpiresAt: profile.githubRefreshTokenExpiresAt ?? null
      }))
    };
  }

  async function saveSettings() {
    return saveSettingsWithDefault(defaultProviderProfileId);
  }

  async function saveSettingsWithDefault(nextDefaultProviderProfileId: string) {
    const response = await fetch("/api/settings/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await buildSettingsPayload(nextDefaultProviderProfileId))
    });

    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      toast.showToast("error", result.error ?? "Unable to save settings");
      return false;
    }

    return true;
  }

  async function handleSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toast.dismissToast();

    if (await saveSettings()) {
      toast.showToast("success", "Provider saved.");
    }
  }

  async function runConnectionTest() {
    setTestResult(null);
    const response = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerProfileId: selectedProviderProfileId })
    });
    const result = (await response.json()) as { text?: string; error?: string };
    const text = result.text ?? result.error ?? "No result";
    setTestResult({ text, isSuccess: response.ok && !result.error });
  }

  async function handleToggleDefault() {
    if (!activeProviderProfile || activeProviderProfile.id === defaultProviderProfileId) {
      return;
    }
    toast.dismissToast();
    if (await saveSettingsWithDefault(activeProviderProfile.id)) {
      setDefaultProviderProfileId(activeProviderProfile.id);
      toast.showToast("success", "Default provider updated.");
    }
  }

  function openSystemPrompt() {
    if (!activeProviderProfile) return;
    setIsSystemPromptOpen(true);
  }

  function saveSystemPrompt(value: string) {
    updateActiveProviderProfile({ systemPrompt: value });
    setIsSystemPromptOpen(false);
  }

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike =
    "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const selectLike = `${inputLike} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10`;
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Providers</h2>
              <p className="text-xs text-[var(--muted)]">
                {providerProfiles.length} profile{providerProfiles.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={addProviderProfile}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.07] transition-all duration-200"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        }
        listPanel={
          <>
            {providerProfiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                isActive={profile.id === selectedProviderProfileId}
                onClick={() => {
                  setSelectedProviderProfileId(profile.id);
                  setMobileDetailVisible(true);
                }}
                title={profile.name}
                subtitle={
                  profile.providerKind === "github_copilot"
                    ? `Copilot${profile.model ? ` · ${profile.model}` : ""}`
                    : `${profile.model} · ${profile.apiMode}`
                }
                badges={[
                  ...(profile.id === defaultProviderProfileId
                    ? [{ variant: "default" as const, label: "DEFAULT" }]
                    : []),
                  ...(!profile.hasApiKey && !profile.apiKey && profile.providerKind !== "github_copilot"
                    ? [{ variant: "no-key" as const, label: "NO KEY" }]
                    : []),
                  ...(profile.providerKind === "github_copilot" && profile.githubConnectionStatus === "disconnected"
                    ? [{ variant: "no-key" as const, label: "NOT CONNECTED" }]
                    : [])
                ]}
              />
            ))}
          </>
        }
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        detailPanel={
          <form
            onSubmit={(event) => void handleSettings(event)}
            className="w-full max-w-[840px]"
          >
            {activeProviderProfile ? (
              <div className="space-y-0">
                {/* Header */}
                <div className="pb-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--text)]">
                      {activeProviderProfile.name}
                    </h3>
                    {activeProviderProfile.id === defaultProviderProfileId && (
                      <span className="inline-flex items-center rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                        Default
                      </span>
                    )}
                    {!activeProviderProfile.hasApiKey && !activeProviderProfile.apiKey && activeProviderProfile.providerKind !== "github_copilot" && (
                      <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                        No key
                      </span>
                    )}
                    {activeProviderProfile.providerKind === "github_copilot" && activeProviderProfile.githubConnectionStatus === "disconnected" && (
                      <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                        Not connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {isCopilot
                      ? `GitHub Copilot${activeProviderProfile.model ? ` · ${activeProviderProfile.model}` : ""}`
                      : `${activeProviderProfile.apiBaseUrl} · ${activeProviderProfile.model} · ${activeProviderProfile.apiMode}`}
                  </p>
                </div>

                {/* Identity */}
                <div className={`${sectionDivider} py-5`}>
                  <h4 className={sectionTitle}>Identity</h4>
                  <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className={fieldLabel}>Profile name</label>
                      <Input
                        name="provider-profile-name"
                        autoComplete="off"
                        value={activeProviderProfile.name}
                        onChange={(event) =>
                          updateActiveProviderProfile({ name: event.target.value })
                        }
                        required
                      />
                      {isDuplicateName && (
                        <p className="mt-1 text-xs text-red-400">A profile with this name already exists</p>
                      )}
                    </div>
                    <label className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] cursor-pointer sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={activeProviderProfile.id === defaultProviderProfileId}
                        onChange={() => {
                          if (activeProviderProfile.id !== defaultProviderProfileId) {
                            void handleToggleDefault();
                          }
                        }}
                        disabled={activeProviderProfile.id === defaultProviderProfileId}
                      />
                      Default provider
                    </label>
                    <div>
                      <label className={fieldLabel}>Provider type</label>
                      <select
                        className={selectLike}
                        value={activeProviderProfile.providerKind ?? "openai_compatible"}
                        onChange={(event) => {
                          const value = event.target.value as "openai_compatible" | "github_copilot";
                          if (value === "github_copilot") {
                            updateActiveProviderProfile({
                              providerKind: "github_copilot",
                              apiBaseUrl: "",
                              apiKey: "",
                              model: "",
                              apiMode: "responses",
                              systemPrompt: "",
                              tokenizerModel: "off",
                              providerPresetId: null
                            });
                          } else {
                            updateActiveProviderProfile({
                              providerKind: "openai_compatible",
                              apiBaseUrl: activeProviderProfile.apiBaseUrl || "https://api.openai.com/v1",
                              apiKey: "",
                              providerPresetId: null
                            });
                          }
                        }}
                      >
                        <option value="openai_compatible">OpenAI compatible</option>
                        <option value="github_copilot">GitHub Copilot</option>
                      </select>
                    </div>
                    {!isCopilot && (
                      <div>
                        <label className={fieldLabel}>Provider preset</label>
                        <select
                          value={activeProviderPresetId ?? ""}
                          onChange={(event) => {
                            const nextPresetId = event.target.value as ProviderPresetId;
                            if (!nextPresetId) return;
                            applyPresetToActiveProviderProfile(nextPresetId);
                          }}
                          className={selectLike}
                        >
                          <option value="">Manual configuration</option>
                          {PROVIDER_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                {/* Connection */}
                <div className={`${sectionDivider} py-5`}>
                  <h4 className={sectionTitle}>Connection</h4>
                  {isCopilot ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[var(--text)]">
                        {activeProviderProfile.githubConnectionStatus === "connected"
                          ? `Connected as ${activeProviderProfile.githubAccountLogin ?? "GitHub user"}`
                          : "No GitHub account connected"}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          className="px-3 py-1.5 text-xs"
                          onClick={async () => {
                            if (await saveSettings()) {
                              window.location.href = `/api/providers/github/connect?providerProfileId=${activeProviderProfile.id}`;
                            }
                          }}
                        >
                          {activeProviderProfile.githubConnectionStatus === "connected"
                            ? "Reconnect GitHub"
                            : "Connect GitHub"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={async () => {
                            await fetch("/api/providers/github/disconnect", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ providerProfileId: activeProviderProfile.id })
                            });
                            updateActiveProviderProfile({
                              githubConnectionStatus: "disconnected",
                              githubAccountLogin: null,
                              githubAccountName: null
                            });
                          }}
                          disabled={activeProviderProfile.githubConnectionStatus === "disconnected"}
                        >
                          Disconnect
                        </Button>
                      </div>
                      {isCopilot && copilotModels.length > 0 && (
                        <div>
                          <label className={fieldLabel}>Model</label>
                          <select
                            value={activeProviderProfile.model}
                            onChange={(event) => {
                              const selected = copilotModels.find((m) => m.id === event.target.value);
                              updateActiveProviderProfile({
                                model: event.target.value,
                                ...(selected?.maxContextWindowTokens
                                  ? { modelContextLimit: selected.maxContextWindowTokens }
                                  : {})
                              });
                            }}
                            className={selectLike}
                          >
                            {copilotModels.map((model) => (
                              <option key={model.id} value={model.id}>{model.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {isCopilot && copilotModels.length === 0 && activeProviderProfile.githubConnectionStatus !== "connected" && (
                        <div>
                          <label className={fieldLabel}>Model</label>
                          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[var(--muted)]">
                            Connect GitHub to browse models
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <div>
                          <label className={fieldLabel}>API base URL</label>
                          <Input
                            name="provider-api-base-url"
                            autoComplete="url"
                            value={activeProviderProfile.apiBaseUrl}
                            onChange={(event) =>
                              updateActiveProviderProfile({ apiBaseUrl: event.target.value, providerPresetId: null })
                            }
                            required
                          />
                        </div>
                        <div>
                          <label className={fieldLabel}>Model</label>
                          <Input
                            name="provider-model"
                            autoComplete="off"
                            value={activeProviderProfile.model}
                            onChange={(event) =>
                              updateActiveProviderProfile({ model: event.target.value })
                            }
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className={fieldLabel}>API key</label>
                        <div className="relative">
                          <Input
                            name="provider-api-key"
                            autoComplete="new-password"
                            spellCheck={false}
                            type={showApiKey ? "text" : "password"}
                            value={activeProviderProfile.apiKey}
                            onChange={(event) =>
                              updateActiveProviderProfile({
                                apiKey: event.target.value,
                                hasApiKey: activeProviderProfile.hasApiKey || Boolean(event.target.value)
                              })
                            }
                            placeholder={activeProviderProfile.hasApiKey ? maskedApiKeyValue : "sk-..."}
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                          >
                            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Configuration */}
                <div className={`${sectionDivider} py-5`}>
                  <div className="flex items-center justify-between">
                    <h4 className={sectionTitle}>Configuration</h4>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetActiveProviderAdvancedSettings}
                      className="px-2.5 py-1 text-[11px]"
                    >
                      Reset defaults
                    </Button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                    {!isCopilot && (
                      <>
                        <div>
                          <label className={fieldLabel}>Temperature</label>
                          <Input
                            name="provider-temperature"
                            type="number"
                            step="0.1"
                            value={activeProviderProfile.temperature}
                            onChange={(event) =>
                              updateActiveProviderProfile({ temperature: Number(event.target.value || 0) })
                            }
                          />
                        </div>
                        <div>
                          <label className={fieldLabel}>Max output tokens</label>
                          <Input
                            name="provider-max-output-tokens"
                            type="number"
                            value={activeProviderProfile.maxOutputTokens}
                            onChange={(event) =>
                              updateActiveProviderProfile({ maxOutputTokens: Number(event.target.value || 0) })
                            }
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className={fieldLabel}>Reasoning effort</label>
                      <select
                        value={activeProviderProfile.reasoningEffort}
                        onChange={(event) =>
                          updateActiveProviderProfile({ reasoningEffort: event.target.value as ReasoningEffort })
                        }
                        className={selectLike}
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                        <option value="xhigh">xhigh</option>
                      </select>
                    </div>
                    {!isCopilot && (
                      <>
                        <div>
                          <label className={fieldLabel}>API mode</label>
                          <select
                            value={activeProviderProfile.apiMode}
                            onChange={(event) =>
                              updateActiveProviderProfile({ apiMode: event.target.value as ApiMode })
                            }
                            className={selectLike}
                          >
                            <option value="responses">responses</option>
                            <option value="chat_completions">chat_completions</option>
                          </select>
                        </div>
                        <div>
                          <label className={fieldLabel}>Reasoning summary</label>
                          <label className="flex h-[42px] items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 text-sm text-[var(--muted)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={activeProviderProfile.reasoningSummaryEnabled}
                              onChange={(event) =>
                                updateActiveProviderProfile({ reasoningSummaryEnabled: event.target.checked })
                              }
                            />
                            Show reasoning when supported
                          </label>
                        </div>
                      </>
                    )}
                    <div>
                      <label className={fieldLabel}>Model context limit</label>
                      <Input
                        name="provider-model-context-limit"
                        type="number"
                        value={activeProviderProfile.modelContextLimit}
                        onChange={(event) =>
                          updateActiveProviderProfile({ modelContextLimit: Number(event.target.value || 0) })
                        }
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Compaction threshold %</label>
                      <Input
                        name="provider-compaction-threshold"
                        type="number"
                        step="1"
                        min="50"
                        max="95"
                        value={Math.round(activeProviderProfile.compactionThreshold * 100)}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            compactionThreshold: Math.round(Number(event.target.value || 0)) / 100
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Fresh tail turns</label>
                      <Input
                        name="provider-fresh-tail-count"
                        type="number"
                        value={activeProviderProfile.freshTailCount}
                        onChange={(event) =>
                          updateActiveProviderProfile({ freshTailCount: Number(event.target.value || 0) })
                        }
                      />
                    </div>
                    {!isCopilot && (
                      <>
                        <div>
                          <label className={fieldLabel}>Tokenizer model</label>
                          <select
                            value={activeProviderProfile.tokenizerModel}
                            onChange={(event) =>
                              updateActiveProviderProfile({ tokenizerModel: event.target.value as "gpt-tokenizer" | "off" })
                            }
                            className={selectLike}
                          >
                            <option value="gpt-tokenizer">gpt-tokenizer</option>
                            <option value="off">Off (char / 4)</option>
                          </select>
                        </div>
                        <div>
                          <label className={fieldLabel}>Safety margin tokens</label>
                          <Input
                            name="provider-safety-margin-tokens"
                            type="number"
                            value={activeProviderProfile.safetyMarginTokens}
                            onChange={(event) =>
                              updateActiveProviderProfile({ safetyMarginTokens: Number(event.target.value || 0) })
                            }
                          />
                        </div>
                        <div>
                          <label className={fieldLabel}>Leaf source token limit</label>
                          <Input
                            name="provider-leaf-source-token-limit"
                            type="number"
                            value={activeProviderProfile.leafSourceTokenLimit}
                            onChange={(event) =>
                              updateActiveProviderProfile({ leafSourceTokenLimit: Number(event.target.value || 0) })
                            }
                          />
                        </div>
                        <div>
                          <label className={fieldLabel}>Leaf min message count</label>
                          <Input
                            name="provider-leaf-min-message-count"
                            type="number"
                            value={activeProviderProfile.leafMinMessageCount}
                            onChange={(event) =>
                              updateActiveProviderProfile({ leafMinMessageCount: Number(event.target.value || 0) })
                            }
                          />
                        </div>
                        <div>
                          <label className={fieldLabel}>Merged min node count</label>
                          <Input
                            name="provider-merged-min-node-count"
                            type="number"
                            value={activeProviderProfile.mergedMinNodeCount}
                            onChange={(event) =>
                              updateActiveProviderProfile({ mergedMinNodeCount: Number(event.target.value || 0) })
                            }
                          />
                        </div>
                        <div>
                          <label className={fieldLabel}>Merged target tokens</label>
                          <Input
                            name="provider-merged-target-tokens"
                            type="number"
                            value={activeProviderProfile.mergedTargetTokens}
                            onChange={(event) =>
                              updateActiveProviderProfile({ mergedTargetTokens: Number(event.target.value || 0) })
                            }
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className={fieldLabel}>Vision mode</label>
                      <select
                        value={activeProviderProfile.visionMode ?? "native"}
                        onChange={(event) =>
                          updateActiveProviderProfile({ visionMode: event.target.value as VisionMode })
                        }
                        className={selectLike}
                      >
                        <option value="native">native</option>
                        <option value="none">none</option>
                        <option value="mcp">mcp</option>
                      </select>
                    </div>
                    {activeProviderProfile.visionMode === "mcp" && (
                      <div>
                        <label className={fieldLabel}>Vision MCP server</label>
                        <select
                          value={activeProviderProfile.visionMcpServerId ?? ""}
                          onChange={(event) =>
                            updateActiveProviderProfile({ visionMcpServerId: event.target.value || null })
                          }
                          className={selectLike}
                        >
                          <option value="">Select a server...</option>
                          {mcpServers
                            .filter((server) => server.enabled)
                            .map((server) => (
                              <option key={server.id} value={server.id}>
                                {server.name}
                              </option>
                            ))}
                        </select>
                        {activeProviderProfile.visionMcpServerId === null && (
                          <p className="mt-1.5 text-xs text-amber-400">
                            Select an MCP server for image analysis
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* System */}
                <div className={`${sectionDivider} py-5`}>
                  <h4 className={sectionTitle}>System</h4>
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className={fieldLabel}>System prompt</label>
                        <button
                          type="button"
                          onClick={openSystemPrompt}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                      <p className="mb-1.5 text-xs text-[var(--muted)]">
                        Applied to new conversations only
                      </p>
                      <div
                        onClick={openSystemPrompt}
                        className="cursor-pointer rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--muted)] line-clamp-3 hover:bg-white/[0.06] transition-colors"
                      >
                        {activeProviderProfile.systemPrompt || "No system prompt set"}
                      </div>
                    </div>
                    <label className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-[var(--muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skillsEnabled}
                        onChange={(event) => setSkillsEnabled(event.target.checked)}
                      />
                      Make enabled skills available to every chat in this workspace
                    </label>
                  </div>
                </div>

                {/* Actions */}
                <div className={`${sectionDivider} py-5`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="submit" className="px-3 py-1.5 text-xs" disabled={isDuplicateName}>
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={runConnectionTest}
                        className="gap-1.5 px-2.5 py-1.5 text-xs"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Test
                      </Button>

                    </div>
                    <button
                      type="button"
                      onClick={() => removeProviderProfile(activeProviderProfile.id)}
                      disabled={providerProfiles.length === 1}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>

                {/* Messages */}
                {testResult ? (
                  <p className={`pt-2 text-sm ${testResult.isSuccess ? "text-emerald-400" : "text-red-300"}`}>
                    {testResult.text}
                  </p>
                ) : null}

                <TextEditModal
                  open={isSystemPromptOpen}
                  onOpenChange={setIsSystemPromptOpen}
                  value={activeProviderProfile?.systemPrompt ?? ""}
                  onChange={saveSystemPrompt}
                  title="Edit system prompt"
                  subtitle="Applied to new conversations only"
                />
                <Toast
                  visible={toast.visible}
                  variant={toast.variant}
                  message={toast.message}
                />
              </div>
            ) : null}
          </form>
        }
      />
    </div>
  );
}
