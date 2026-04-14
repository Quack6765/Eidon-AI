"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Plus,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Zap,
  Shield,
  FlaskConical
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createId } from "@/lib/ids";
import {
  applyProviderPreset,
  getMatchingProviderPresetId,
  PROVIDER_PRESETS,
  type ProviderPresetId
} from "@/lib/provider-presets";
import type { AppSettings, ApiMode, McpServer, ReasoningEffort, VisionMode } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";
import { CollapsibleSection } from "../collapsible-section";

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
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [testResult, setTestResult] = useState("");
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
    ? getMatchingProviderPresetId(activeProviderProfile)
    : null;
  const isCopilot = activeProviderProfile?.providerKind === "github_copilot";

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

    updateActiveProviderProfile(applyProviderPreset(activeProviderProfile, presetId));
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
      setError(result.error ?? "Unable to save settings");
      return false;
    }

    return true;
  }

  async function handleSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (await saveSettings()) {
      setSuccess("Settings saved.");
    }
  }

  async function runConnectionTest() {
    setTestResult("");
    const response = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerProfileId: selectedProviderProfileId })
    });
    const result = (await response.json()) as { text?: string; error?: string };
    setTestResult(result.text ?? result.error ?? "No result");
  }

  const selectClass =
    "w-full rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm outline-none focus:border-[rgba(139,92,246,0.3)] transition-all duration-200 text-[#f4f4f5]";
  const labelClass = "text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#71717a]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Providers</h2>
              <p className="text-[0.68rem] text-[#52525b]">
                {providerProfiles.length} profile{providerProfiles.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={addProviderProfile}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] hover:text-[#f4f4f5] hover:bg-white/[0.06] transition-all duration-200"
            >
              <Plus className="h-4 w-4" />
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
            className="max-w-[560px] space-y-6"
          >
            {activeProviderProfile ? (
              <>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-[1.1rem] font-semibold text-[#f4f4f5]">
                      {activeProviderProfile.name}
                    </h3>
                    <p className="mt-0.5 text-[0.75rem] text-[#52525b]">
                      {isCopilot
                        ? `GitHub Copilot${activeProviderProfile.model ? ` · ${activeProviderProfile.model}` : ""}`
                        : `${activeProviderProfile.apiBaseUrl} · ${activeProviderProfile.model} · ${activeProviderProfile.apiMode}`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={runConnectionTest}
                      className="gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        setError("");
                        setSuccess("");
                        const nextDefaultProfileId = activeProviderProfile.id;

                        if (await saveSettingsWithDefault(nextDefaultProfileId)) {
                          setDefaultProviderProfileId(nextDefaultProfileId);
                        }
                      }}
                      disabled={activeProviderProfile.id === defaultProviderProfileId}
                      className="gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Shield className="h-3.5 w-3.5" />
                      {activeProviderProfile.id === defaultProviderProfileId
                        ? "Is Default"
                        : "Set Default"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => removeProviderProfile(activeProviderProfile.id)}
                      disabled={providerProfiles.length === 1}
                      className="gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className={labelClass}>Provider type</label>
                    <select
                      className={selectClass}
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
                            tokenizerModel: "off"
                          });
                        } else {
                          updateActiveProviderProfile({
                            providerKind: "openai_compatible",
                            apiBaseUrl: activeProviderProfile.apiBaseUrl || "https://api.openai.com/v1",
                            apiKey: ""
                          });
                        }
                      }
                    }
                    >
                      <option value="openai_compatible">OpenAI compatible</option>
                      <option value="github_copilot">GitHub Copilot</option>
                    </select>
                  </div>

                  {!isCopilot && (
                    <div>
                      <label className={labelClass}>Provider preset</label>
                      <select
                        value={activeProviderPresetId ?? ""}
                        onChange={(event) => {
                          const nextPresetId = event.target.value as ProviderPresetId;

                          if (!nextPresetId) {
                            return;
                          }

                          applyPresetToActiveProviderProfile(nextPresetId);
                        }}
                        className={selectClass}
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

                  <div>
                    <label className={labelClass}>Profile name</label>
                    <Input
                      name="provider-profile-name"
                      autoComplete="off"
                      value={activeProviderProfile.name}
                      onChange={(event) =>
                        updateActiveProviderProfile({ name: event.target.value })
                      }
                      required
                    />
                  </div>

                  {isCopilot ? (
                    <div className="space-y-3">
                      <p className={labelClass}>GitHub connection</p>
                      <div className="rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm text-[#f4f4f5]">
                        {activeProviderProfile.githubConnectionStatus === "connected"
                          ? `Connected as ${activeProviderProfile.githubAccountLogin ?? "GitHub user"}`
                          : "No GitHub account connected"}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
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
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className={labelClass}>API base URL</label>
                          <Input
                            name="provider-api-base-url"
                            autoComplete="url"
                            value={activeProviderProfile.apiBaseUrl}
                            onChange={(event) =>
                              updateActiveProviderProfile({ apiBaseUrl: event.target.value })
                            }
                            required
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Model</label>
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
                        <label className={labelClass}>API key</label>
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
                                hasApiKey:
                                  activeProviderProfile.hasApiKey || Boolean(event.target.value)
                              })
                            }
                            placeholder={
                              activeProviderProfile.hasApiKey
                                ? "Stored securely. Leave blank to keep."
                                : "sk-..."
                            }
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52525b] hover:text-[#a1a1aa] transition-colors"
                          >
                            {showApiKey ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {isCopilot && copilotModels.length > 0 && (
                    <div>
                      <label className={labelClass}>Model</label>
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
                        className={selectClass}
                      >
                        {copilotModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {isCopilot && copilotModels.length === 0 && activeProviderProfile.githubConnectionStatus !== "connected" && (
                    <div>
                      <label className={labelClass}>Model</label>
                      <div className="rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm text-[#52525b]">
                        Connect GitHub to browse models
                      </div>
                    </div>
                  )}
                </div>

                <CollapsibleSection
                  title="Advanced Settings"
                  icon={<FlaskConical className="h-4 w-4" />}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {!isCopilot && (
                      <>
                        <div>
                          <label className={labelClass}>Temperature</label>
                          <Input
                            name="provider-temperature"
                            type="number"
                            step="0.1"
                            value={activeProviderProfile.temperature}
                            onChange={(event) =>
                              updateActiveProviderProfile({
                                temperature: Number(event.target.value || 0)
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Max output tokens</label>
                          <Input
                            name="provider-max-output-tokens"
                            type="number"
                            value={activeProviderProfile.maxOutputTokens}
                            onChange={(event) =>
                              updateActiveProviderProfile({
                                maxOutputTokens: Number(event.target.value || 0)
                              })
                            }
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className={labelClass}>Reasoning effort</label>
                      <select
                        value={activeProviderProfile.reasoningEffort}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            reasoningEffort: event.target.value as ReasoningEffort
                          })
                        }
                        className={selectClass}
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
                          <label className={labelClass}>Reasoning summary</label>
                          <label className="flex h-[46px] items-center gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-4 text-[0.82rem] text-[#a1a1aa] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={activeProviderProfile.reasoningSummaryEnabled}
                              onChange={(event) =>
                                updateActiveProviderProfile({
                                  reasoningSummaryEnabled: event.target.checked
                                })
                              }
                            />
                            Show reasoning when supported
                          </label>
                        </div>
                        <div>
                          <label className={labelClass}>API mode</label>
                          <select
                            value={activeProviderProfile.apiMode}
                            onChange={(event) =>
                              updateActiveProviderProfile({ apiMode: event.target.value as ApiMode })
                            }
                            className={selectClass}
                          >
                            <option value="responses">responses</option>
                            <option value="chat_completions">chat_completions</option>
                          </select>
                        </div>
                      </>
                    )}
                    <div>
                      <label className={labelClass}>Model context limit</label>
                      <Input
                        name="provider-model-context-limit"
                        type="number"
                        value={activeProviderProfile.modelContextLimit}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            modelContextLimit: Number(event.target.value || 0)
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Compaction threshold %</label>
                      <Input
                        name="provider-compaction-threshold"
                        type="number"
                        step="1"
                        min="50"
                        max="95"
                        value={Math.round(activeProviderProfile.compactionThreshold * 100)}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            compactionThreshold:
                              Math.round(Number(event.target.value || 0)) / 100
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Fresh tail turns</label>
                      <Input
                        name="provider-fresh-tail-count"
                        type="number"
                        value={activeProviderProfile.freshTailCount}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            freshTailCount: Number(event.target.value || 0)
                          })
                        }
                      />
                    </div>
                    {!isCopilot && (
                      <>
                        <div>
                          <label className={labelClass}>Tokenizer model</label>
                          <select
                            value={activeProviderProfile.tokenizerModel}
                            onChange={(event) =>
                              updateActiveProviderProfile({ tokenizerModel: event.target.value as "gpt-tokenizer" | "off" })
                            }
                            className={selectClass}
                          >
                            <option value="gpt-tokenizer">gpt-tokenizer</option>
                            <option value="off">Off (char / 4)</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Safety margin tokens</label>
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
                          <label className={labelClass}>Leaf source token limit</label>
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
                          <label className={labelClass}>Leaf min message count</label>
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
                          <label className={labelClass}>Merged min node count</label>
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
                          <label className={labelClass}>Merged target tokens</label>
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
                      <label className={labelClass}>Vision mode</label>
                      <select
                        value={activeProviderProfile.visionMode ?? "native"}
                        onChange={(event) =>
                          updateActiveProviderProfile({ visionMode: event.target.value as VisionMode })
                        }
                        className={selectClass}
                      >
                        <option value="native">native</option>
                        <option value="none">none</option>
                        <option value="mcp">mcp</option>
                      </select>
                    </div>
                    {activeProviderProfile.visionMode === "mcp" && (
                      <div>
                        <label className={labelClass}>Vision MCP server</label>
                        <select
                          value={activeProviderProfile.visionMcpServerId ?? ""}
                          onChange={(event) =>
                            updateActiveProviderProfile({ visionMcpServerId: event.target.value || null })
                          }
                          className={selectClass}
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
                          <p className="mt-1 text-xs text-amber-400">
                            Select an MCP server for image analysis
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="System Prompt & Skills"
                  icon={<Sparkles className="h-4 w-4" />}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div>
                      <label className={labelClass}>
                        System prompt (applied to new conversations only)
                      </label>
                      <Textarea
                        name="provider-system-prompt"
                        autoComplete="off"
                        spellCheck={false}
                        value={activeProviderProfile.systemPrompt}
                        onChange={(event) =>
                          updateActiveProviderProfile({ systemPrompt: event.target.value })
                        }
                        rows={5}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Workspace skills</label>
                      <label className="flex h-[46px] items-center gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-4 text-[0.82rem] text-[#a1a1aa] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skillsEnabled}
                          onChange={(event) => setSkillsEnabled(event.target.checked)}
                        />
                        Make enabled skills available to every chat in this workspace
                      </label>
                    </div>
                  </div>
                </CollapsibleSection>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button type="submit">Save Changes</Button>
                  {success ? (
                    <div className="flex items-center gap-1.5 text-sm text-emerald-400">
                      <Check className="h-3.5 w-3.5" />
                      {success}
                    </div>
                  ) : null}
                </div>

                {testResult ? (
                  <p className="text-[0.82rem] text-[#71717a]">{testResult}</p>
                ) : null}

                {error ? (
                  <div className="rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                ) : null}
              </>
            ) : null}
          </form>
        }
      />
    </div>
  );
}
