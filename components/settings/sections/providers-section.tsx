"use client";

import { type FormEvent, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createId } from "@/lib/ids";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import {
  applyProviderPreset,
  getMatchingProviderPresetId,
  PROVIDER_PRESETS,
  type ProviderPresetId
} from "@/lib/provider-presets";
import type { ApiMode, ReasoningEffort } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";
import { CollapsibleSection } from "../collapsible-section";

type SettingsPayload = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  providerProfiles: Array<{
    id: string;
    name: string;
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
    createdAt: string;
    updatedAt: string;
    hasApiKey: boolean;
  }>;
  updatedAt: string;
};

type ProviderProfileDraft = SettingsPayload["providerProfiles"][number] & {
  apiKey: string;
};

export function ProvidersSection({ settings }: { settings: SettingsPayload }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [testResult, setTestResult] = useState("");
  const [defaultProviderProfileId, setDefaultProviderProfileId] = useState(
    settings.defaultProviderProfileId
  );
  const [skillsEnabled, setSkillsEnabled] = useState(settings.skillsEnabled);
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState(
    settings.defaultProviderProfileId
  );
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfileDraft[]>(
    settings.providerProfiles.map((profile) => ({
      ...profile,
      apiKey: ""
    }))
  );
  const [mobileDetailVisible, setMobileDetailVisible] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const activeProviderProfile = useMemo(
    () =>
      providerProfiles.find((profile) => profile.id === selectedProviderProfileId) ??
      providerProfiles[0],
    [providerProfiles, selectedProviderProfileId]
  );
  const visibleReasoningSupported = activeProviderProfile
    ? supportsVisibleReasoning(activeProviderProfile.model, activeProviderProfile.apiMode)
    : false;
  const activeProviderPresetId = activeProviderProfile
    ? getMatchingProviderPresetId(activeProviderProfile)
    : null;

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
        systemPrompt: "You are a precise, practical assistant. Answer clearly and directly.",
        temperature: 0.7,
        maxOutputTokens: 1200,
        reasoningEffort: "medium" as ReasoningEffort,
        reasoningSummaryEnabled: true,
        modelContextLimit: 128000,
        compactionThreshold: 0.78,
        freshTailCount: 28,
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

  async function handleSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const payload = {
      defaultProviderProfileId,
      skillsEnabled,
      providerProfiles: providerProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
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
        compactionThreshold: profile.compactionThreshold,
        freshTailCount: profile.freshTailCount
      }))
    };

    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Unable to save settings");
      return;
    }
    setSuccess("Settings saved.");
    router.refresh();
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
    <div className="h-full p-6 md:p-8">
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
                subtitle={`${profile.model} \u00B7 ${profile.apiMode}`}
                badges={[
                  ...(profile.id === defaultProviderProfileId
                    ? [{ variant: "default" as const, label: "DEFAULT" }]
                    : []),
                  ...(!profile.hasApiKey && !profile.apiKey
                    ? [{ variant: "no-key" as const, label: "NO KEY" }]
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
                      {activeProviderProfile.apiBaseUrl} &middot; {activeProviderProfile.model}{" "}
                      &middot; {activeProviderProfile.apiMode}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
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
                      onClick={() => setDefaultProviderProfileId(activeProviderProfile.id)}
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

                  <div>
                    <label className={labelClass}>Profile name</label>
                    <Input
                      value={activeProviderProfile.name}
                      onChange={(event) =>
                        updateActiveProviderProfile({ name: event.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>API base URL</label>
                      <Input
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
                </div>

                <CollapsibleSection
                  title="Advanced Settings"
                  icon={<FlaskConical className="h-4 w-4" />}
                  defaultOpen={false}
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Temperature</label>
                      <Input
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
                        type="number"
                        value={activeProviderProfile.maxOutputTokens}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            maxOutputTokens: Number(event.target.value || 0)
                          })
                        }
                      />
                    </div>
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
                    <div>
                      <label className={labelClass}>Model context limit</label>
                      <Input
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
                      <label className={labelClass}>Compaction threshold</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={activeProviderProfile.compactionThreshold}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            compactionThreshold: Number(event.target.value || 0)
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Fresh tail count</label>
                      <Input
                        type="number"
                        value={activeProviderProfile.freshTailCount}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            freshTailCount: Number(event.target.value || 0)
                          })
                        }
                      />
                    </div>
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
