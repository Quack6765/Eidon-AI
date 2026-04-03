"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, Trash2, Check } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          Providers
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage provider profiles and runtime configuration.
        </p>
      </div>

      <form
        onSubmit={(event) => void handleSettings(event)}
        className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-8"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
              Runtime settings
            </p>
            <h2
              className="mt-1 text-3xl leading-none text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Provider + context controls
            </h2>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Saved profiles</Label>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                  Each profile stores a full runtime configuration. New conversations start with
                  the default profile.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={addProviderProfile}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add profile
              </Button>
            </div>

            <div className="space-y-2">
              {providerProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className={`rounded-xl border px-4 py-3 transition-all duration-200 cursor-pointer ${
                    profile.id === selectedProviderProfileId
                      ? "border-[var(--accent)]/20 bg-[var(--accent-soft)]"
                      : "border-white/4 bg-white/[0.01] hover:bg-white/[0.03]"
                  }`}
                  onClick={() => setSelectedProviderProfileId(profile.id)}
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text)]">
                          {profile.name}
                        </span>
                        {profile.id === defaultProviderProfileId ? (
                          <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                            <Check className="h-2.5 w-2.5" />
                            default
                          </span>
                        ) : null}
                        {!profile.hasApiKey && !profile.apiKey ? (
                          <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                            no key
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                        {profile.model} · {profile.apiMode} · {profile.apiBaseUrl}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer">
                        <input
                          type="radio"
                          name="defaultProviderProfileId"
                          checked={profile.id === defaultProviderProfileId}
                          onChange={() => setDefaultProviderProfileId(profile.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        Default
                      </label>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProviderProfile(profile.id);
                        }}
                        disabled={providerProfiles.length === 1}
                        className="p-1 text-red-400/40 transition-colors duration-200 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {activeProviderProfile ? (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Provider preset</Label>
                <select
                  value={activeProviderPresetId ?? ""}
                  onChange={(event) => {
                    const nextPresetId = event.target.value as ProviderPresetId;

                    if (!nextPresetId) {
                      return;
                    }

                    applyPresetToActiveProviderProfile(nextPresetId);
                  }}
                  className="w-full rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]/30 transition-all duration-200"
                >
                  <option value="">Manual configuration</option>
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                  Applying a preset updates the provider connection fields while keeping your API
                  key, prompt, and runtime tuning.
                </p>
              </div>

              <div className="md:col-span-2">
                <Label>Profile name</Label>
                <Input
                  value={activeProviderProfile.name}
                  onChange={(event) => updateActiveProviderProfile({ name: event.target.value })}
                  required
                />
              </div>

              <div className="md:col-span-2">
                <Label>API base URL</Label>
                <Input
                  value={activeProviderProfile.apiBaseUrl}
                  onChange={(event) =>
                    updateActiveProviderProfile({ apiBaseUrl: event.target.value })
                  }
                  required
                />
              </div>

              <div>
                <Label>API mode</Label>
                <select
                  value={activeProviderProfile.apiMode}
                  onChange={(event) =>
                    updateActiveProviderProfile({ apiMode: event.target.value as ApiMode })
                  }
                  className="w-full rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]/30 transition-all duration-200"
                >
                  <option value="responses">responses</option>
                  <option value="chat_completions">chat_completions</option>
                </select>
              </div>

              <div>
                <Label>Model</Label>
                <Input
                  value={activeProviderProfile.model}
                  onChange={(event) => updateActiveProviderProfile({ model: event.target.value })}
                  required
                />
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                  {visibleReasoningSupported
                    ? "This model can emit visible reasoning summaries through the Responses API."
                    : "This model is treated as non-reasoning here, so visible thinking will stay hidden even if the toggle below is on."}
                </p>
              </div>

              <div className="md:col-span-2">
                <Label>API key</Label>
                <Input
                  type="password"
                  value={activeProviderProfile.apiKey}
                  onChange={(event) =>
                    updateActiveProviderProfile({
                      apiKey: event.target.value,
                      hasApiKey: activeProviderProfile.hasApiKey || Boolean(event.target.value)
                    })
                  }
                  placeholder={
                    activeProviderProfile.hasApiKey
                      ? "Stored securely. Leave blank to keep."
                      : "sk-..."
                  }
                />
              </div>

              <div className="md:col-span-2">
                <Label>System prompt (applied to new conversations only)</Label>
                <Textarea
                  value={activeProviderProfile.systemPrompt}
                  onChange={(event) =>
                    updateActiveProviderProfile({ systemPrompt: event.target.value })
                  }
                  rows={5}
                  required
                />
              </div>

              <div className="md:col-span-2">
                <Label>Workspace skills</Label>
                <label className="flex h-[50px] items-center gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-4 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skillsEnabled}
                    onChange={(event) => setSkillsEnabled(event.target.checked)}
                  />
                  Make enabled skills available to every chat in this workspace
                </label>
              </div>

              <div>
                <Label>Temperature</Label>
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
                <Label>Max output tokens</Label>
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
                <Label>Reasoning effort</Label>
                <select
                  value={activeProviderProfile.reasoningEffort}
                  onChange={(event) =>
                    updateActiveProviderProfile({
                      reasoningEffort: event.target.value as ReasoningEffort
                    })
                  }
                  className="w-full rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]/30 transition-all duration-200"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                </select>
              </div>

              <div>
                <Label>Reasoning summary</Label>
                <label className="flex h-[50px] items-center gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-4 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeProviderProfile.reasoningSummaryEnabled}
                    onChange={(event) =>
                      updateActiveProviderProfile({
                        reasoningSummaryEnabled: event.target.checked
                      })
                    }
                  />
                  Show reasoning when provider supports it
                </label>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                  Best results here come from reasoning-capable models like GPT-5 and OpenAI
                  o-series models on the Responses API.
                </p>
              </div>

              <div>
                <Label>Model context limit</Label>
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
                <Label>Compaction threshold</Label>
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
                <Label>Fresh tail count</Label>
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
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Save settings</Button>
          <Button type="button" variant="secondary" onClick={runConnectionTest}>
            Test connection
          </Button>
          {success ? (
            <div className="flex items-center gap-1.5 text-sm text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              {success}
            </div>
          ) : null}
          {testResult ? <p className="text-sm text-[var(--muted)]">{testResult}</p> : null}
        </div>

        {error ? (
          <div className="rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}
      </form>
    </div>
  );
}
