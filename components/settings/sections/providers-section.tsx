"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Plus,
  Trash2,
  Zap
} from "lucide-react";

import { ProviderConnectionFields } from "@/components/settings/provider-connection-fields";
import { SettingsAccordion } from "@/components/settings/settings-accordion";
import { DetailActionBar } from "@/components/settings/detail-action-bar";
import { DetailHeader } from "@/components/settings/detail-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TextEditModal } from "@/components/ui/text-edit-modal";
import { Toast } from "@/components/ui/toast";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useToastState } from "@/hooks/use-toast-state";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { createId } from "@/lib/ids";
import {
  DEFAULT_PROFILE_BEHAVIOR,
  getProviderPreset,
  PROVIDER_CATALOG,
  PROVIDER_PRESETS
} from "@/lib/provider-catalog";
import {
  applyPresetToProviderProfile,
  buildProviderProfileInput,
  createProviderProfileEditorDraft,
  getMatchingEditorPresetId,
  setProviderApiMode,
  setProviderProcessingMode,
  switchProviderProfileKind,
  toProviderProfileEditorDrafts,
  type ProviderProfileEditorDraft
} from "@/lib/provider-profile-editor";
import {
  getProviderApiBaseUrl,
  getProviderApiMode,
  getProviderProcessingMode,
  resolveProviderProfileCapabilities
} from "@/lib/provider-profile";
import { supportsImageInput } from "@/lib/model-capabilities";
import type { AppSettings, McpServer, ProviderKind, ProviderPresetId, ProviderProfileSummary, ReasoningEffort, VisionMode } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";

type SettingsPayload = AppSettings & {
  providerProfiles: ProviderProfileSummary[];
  updatedAt: string;
};

type ProviderProfileDraft = ProviderProfileEditorDraft;

const toProviderDrafts = toProviderProfileEditorDrafts;

function buildDirtySnapshot(
  profile: ProviderProfileDraft | undefined,
  defaultProviderProfileId: string,
  skillsEnabled: boolean
) {
  return {
    activeProviderProfileId: profile?.id ?? "",
    activeProviderKind: profile?.providerKind,
    activeName: profile?.name ?? "",
    activeProviderConfig: profile?.providerConfig ?? {},
    activeCredential: profile?.credential ?? "",
    activeCredentialAction: profile?.credentialAction ?? "preserve",
    activeModel: profile?.model ?? "",
    activeSystemPrompt: profile?.systemPrompt ?? "",
    activeTemperature: profile?.temperature,
    activeMaxOutputTokens: profile?.maxOutputTokens,
    activeReasoningEffort: profile?.reasoningEffort,
    activeReasoningSummaryEnabled: profile?.reasoningSummaryEnabled,
    activeModelContextLimit: profile?.modelContextLimit,
    activeCompactionThreshold: profile?.compactionThreshold,
    activeFreshTailCount: profile?.freshTailCount,
    activeTokenizerModel: profile?.tokenizerModel,
    activeSafetyMarginTokens: profile?.safetyMarginTokens,
    activeLeafSourceTokenLimit: profile?.leafSourceTokenLimit,
    activeLeafMinMessageCount: profile?.leafMinMessageCount,
    activeMergedMinNodeCount: profile?.mergedMinNodeCount,
    activeMergedTargetTokens: profile?.mergedTargetTokens,
    activeVisionMode: profile?.visionMode,
    activeVisionProviderProfileId: profile?.visionProviderProfileId ?? null,
    defaultProviderProfileId,
    skillsEnabled
  };
}

export function ProvidersSection({ settings }: { settings: SettingsPayload }) {
  const toast = useToastState();
  const [testResult, setTestResult] = useState<{ text: string; isSuccess: boolean } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [defaultProviderProfileId, setDefaultProviderProfileId] = useState(
    settings.defaultProviderProfileId ?? settings.providerProfiles[0]?.id ?? ""
  );
  const [skillsEnabled, setSkillsEnabled] = useState(settings.skillsEnabled);
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState(
    settings.defaultProviderProfileId ?? settings.providerProfiles[0]?.id ?? ""
  );
  const initialProviderProfiles = toProviderDrafts(settings.providerProfiles);
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfileDraft[]>(initialProviderProfiles);
  const persistedProviderProfiles = useRef(initialProviderProfiles);
  const persistedDefaultProviderProfileId = useRef(defaultProviderProfileId);
  const persistedSkillsEnabled = useRef(skillsEnabled);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name: string; maxContextWindowTokens: number | null }>>([]);
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const currentActiveProfile = providerProfiles.find((p) => p.id === selectedProviderProfileId) ?? providerProfiles[0];

  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState(
    buildDirtySnapshot(currentActiveProfile, defaultProviderProfileId, skillsEnabled)
  );
  useUnsavedChangesGuard({
    isDirty,
    save: saveSettings,
    discard: restorePersistedProviderSettings,
    entityType: "your provider settings"
  });

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
    ? activeProviderProfile.providerPresetId ?? getMatchingEditorPresetId(activeProviderProfile)
    : null;
  const activeProviderEditor = activeProviderProfile
    ? PROVIDER_CATALOG[activeProviderProfile.providerKind].editor
    : null;
  const activeProviderCapabilities = activeProviderProfile
    ? resolveProviderProfileCapabilities(activeProviderProfile)
    : null;
  const usesThinkingToggle =
    activeProviderEditor?.apiMode &&
    activeProviderProfile &&
    getProviderApiMode(activeProviderProfile) === "chat_completions";
  const isDuplicateName = activeProviderProfile
    ? providerProfiles.some(
        (p) =>
          p.id !== activeProviderProfile.id &&
          p.name.trim().toLowerCase() === activeProviderProfile.name.trim().toLowerCase()
      )
    : false;
  const visionCapableProfiles = useMemo(
    () => activeProviderProfile
      ? providerProfiles.filter(
          (profile) =>
            profile.id !== activeProviderProfile.id &&
            supportsImageInput(profile.model, getProviderApiMode(profile))
        )
      : [],
    [providerProfiles, activeProviderProfile]
  );
  const activeProviderProfileId = activeProviderProfile?.id;
  const shouldDiscoverModels = Boolean(
    activeProviderProfile &&
    PROVIDER_CATALOG[activeProviderProfile.providerKind].editor.modelInput === "discovered" &&
    activeProviderProfile.connection.status === "connected"
  );

  useEffect(() => {
    if (activeProviderProfileId && shouldDiscoverModels) {
      fetch(`/api/providers/${activeProviderProfileId}/models`)
        .then((res) => (res.ok ? res.json() : { models: [] }))
        .then((data) => setDiscoveredModels(data.models ?? []))
        .catch(() => setDiscoveredModels([]));
    } else {
      setDiscoveredModels([]);
    }
  }, [
    activeProviderProfileId,
    shouldDiscoverModels
  ]);

  function updateActiveProviderProfile(patch: Partial<ProviderProfileDraft>) {
    if (!activeProviderProfile) {
      return;
    }

    setProviderProfiles((current) =>
      current.map((profile) =>
        profile.id === activeProviderProfile.id
          ? { ...profile, ...patch } as ProviderProfileDraft
          : profile
      )
    );
  }

  function replaceActiveProviderProfile(profile: ProviderProfileDraft) {
    setProviderProfiles((current) => current.map((candidate) =>
      candidate.id === profile.id ? profile : candidate
    ));
  }

  function restorePersistedProviderSettings() {
    const restoredProfiles = persistedProviderProfiles.current.map((profile) => ({ ...profile }));
    const restoredDefaultProviderProfileId = persistedDefaultProviderProfileId.current;
    const restoredSkillsEnabled = persistedSkillsEnabled.current;
    const restoredSelectedId = restoredProfiles.some((profile) => profile.id === selectedProviderProfileId)
      ? selectedProviderProfileId
      : restoredDefaultProviderProfileId;
    const restoredActive = restoredProfiles.find((profile) => profile.id === restoredSelectedId) ?? restoredProfiles[0];

    setProviderProfiles(restoredProfiles);
    setSelectedProviderProfileId(restoredActive?.id ?? "");
    setDefaultProviderProfileId(restoredDefaultProviderProfileId);
    setSkillsEnabled(restoredSkillsEnabled);
    resetDirty(
      buildDirtySnapshot(
        restoredActive,
        restoredDefaultProviderProfileId,
        restoredSkillsEnabled
      )
    );
  }

  function addProviderProfile(
    sourceProfiles = providerProfiles,
    sourceProfileId = selectedProviderProfileId
  ) {
    const template = sourceProfiles.find((profile) => profile.id === sourceProfileId) ?? sourceProfiles[0];
    const nextProfileId = createId("profile");
    const fallback = createProviderProfileEditorDraft({ id: nextProfileId });
    const timestamp = new Date().toISOString();
    const nextProfile: ProviderProfileDraft = template
      ? {
          ...template,
          id: nextProfileId,
          name: `Profile ${sourceProfiles.length + 1}`,
          credential: "",
          credentialAction: "clear",
          connection: {
            ...template.connection,
            status: "disconnected",
            accountLabel: null,
            expiresAt: null
          },
          createdAt: timestamp,
          updatedAt: timestamp
        }
      : { ...fallback, name: `Profile ${sourceProfiles.length + 1}` };

    setProviderProfiles([...sourceProfiles, nextProfile]);
    setSelectedProviderProfileId(nextProfile.id);
    setMobileDetailVisible(true);
  }

  function applyPresetToActiveProviderProfile(presetId: ProviderPresetId) {
    if (!activeProviderProfile) {
      return;
    }

    const isAutoName = /^Profile \d+$/.test(activeProviderProfile.name);
    const next = applyPresetToProviderProfile(activeProviderProfile, presetId);

    if (isAutoName) {
      next.name = getProviderPreset(presetId).values.name;
    }

    replaceActiveProviderProfile(next);
  }

  function resetActiveProviderAdvancedSettings() {
    if (!activeProviderProfile) {
      return;
    }

    const patch: Partial<ProviderProfileDraft> = {
      reasoningEffort: DEFAULT_PROFILE_BEHAVIOR.reasoningEffort,
      modelContextLimit: DEFAULT_PROFILE_BEHAVIOR.modelContextLimit,
      compactionThreshold: DEFAULT_PROFILE_BEHAVIOR.compactionThreshold,
      freshTailCount: DEFAULT_PROFILE_BEHAVIOR.freshTailCount,
      visionMode: DEFAULT_PROFILE_BEHAVIOR.visionMode,
      visionProviderProfileId: null
    };

    if (activeProviderEditor?.sampling) {
      patch.temperature = DEFAULT_PROFILE_BEHAVIOR.temperature;
      patch.maxOutputTokens = DEFAULT_PROFILE_BEHAVIOR.maxOutputTokens;
      patch.reasoningSummaryEnabled = DEFAULT_PROFILE_BEHAVIOR.reasoningSummaryEnabled;
    }
    if (activeProviderEditor?.tokenization) {
      patch.tokenizerModel = DEFAULT_PROFILE_BEHAVIOR.tokenizerModel;
      patch.safetyMarginTokens = DEFAULT_PROFILE_BEHAVIOR.safetyMarginTokens;
      patch.leafSourceTokenLimit = DEFAULT_PROFILE_BEHAVIOR.leafSourceTokenLimit;
      patch.leafMinMessageCount = DEFAULT_PROFILE_BEHAVIOR.leafMinMessageCount;
      patch.mergedMinNodeCount = DEFAULT_PROFILE_BEHAVIOR.mergedMinNodeCount;
      patch.mergedTargetTokens = DEFAULT_PROFILE_BEHAVIOR.mergedTargetTokens;
    }

    replaceActiveProviderProfile(setProviderProcessingMode(
      setProviderApiMode(
        { ...activeProviderProfile, ...patch } as ProviderProfileDraft,
        activeProviderEditor?.apiMode ? "responses" : getProviderApiMode(activeProviderProfile)
      ),
      "standard"
    ));
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteId) {
      setDeleteConfirmOpen(false);
      return;
    }

    const profileId = pendingDeleteId;
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);

    if (providerProfiles.length === 1) return;

    const nextProfiles = providerProfiles.filter((p) => p.id !== profileId);
    const nextDefault = defaultProviderProfileId === profileId
      ? (nextProfiles.find((p) => p.id === defaultProviderProfileId)?.id ?? nextProfiles[0]?.id ?? "")
      : defaultProviderProfileId;

    const response = await fetch("/api/settings/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await buildSettingsPayload(nextDefault, nextProfiles))
    });
    const result = (await response.json().catch(() => ({}))) as {
      settings?: SettingsPayload;
      error?: string;
    };

    if (response.ok) {
      const savedProfiles = result.settings
        ? toProviderDrafts(result.settings.providerProfiles)
        : nextProfiles.map((profile) => ({
            ...profile,
            credential: "",
            credentialAction: "preserve" as const,
            connection: {
              ...profile.connection,
              status: profile.credentialAction === "replace"
                ? profile.credential ? "connected" : "disconnected"
                : profile.credentialAction === "clear"
                  ? "disconnected"
                  : profile.connection.status
            }
          }));
      const savedDefaultProviderProfileId = result.settings?.defaultProviderProfileId ?? nextDefault;
      const savedSkillsEnabled = result.settings?.skillsEnabled ?? skillsEnabled;
      const newSelectedId = selectedProviderProfileId === profileId
        ? (savedProfiles.find((p) => p.id === savedDefaultProviderProfileId)?.id ?? savedProfiles[0]?.id ?? "")
        : selectedProviderProfileId;
      const newActiveProfile = savedProfiles.find((p) => p.id === newSelectedId) ?? savedProfiles[0];

      persistedProviderProfiles.current = savedProfiles;
      persistedDefaultProviderProfileId.current = savedDefaultProviderProfileId;
      persistedSkillsEnabled.current = savedSkillsEnabled;
      setProviderProfiles(savedProfiles);
      setSelectedProviderProfileId(newSelectedId);
      setDefaultProviderProfileId(savedDefaultProviderProfileId);
      setSkillsEnabled(savedSkillsEnabled);
      resetDirty(
        buildDirtySnapshot(
          newActiveProfile,
          savedDefaultProviderProfileId,
          savedSkillsEnabled
        )
      );

      toast.showToast("success", "Provider deleted.");
    } else {
      toast.showToast("error", result.error ?? "Unable to delete provider");
    }
  }

  async function handleDuplicateProviderProfile() {
    if (!activeProviderProfile) return;

    try {
      const response = await fetch("/api/settings/providers/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceProfileId: activeProviderProfile.id })
      });

      const result = (await response.json()) as {
        settings?: SettingsPayload;
        error?: string;
      };

      if (!response.ok) {
        toast.showToast("error", result.error ?? "Unable to duplicate provider");
        return;
      }

      const savedSettings = result.settings!;
      const newProfiles = toProviderDrafts(savedSettings.providerProfiles);
      const savedDefaultProviderProfileId = savedSettings.defaultProviderProfileId ?? newProfiles[0]?.id ?? "";
      const savedSkillsEnabled = savedSettings.skillsEnabled;
      persistedProviderProfiles.current = newProfiles;
      persistedDefaultProviderProfileId.current = savedDefaultProviderProfileId;
      persistedSkillsEnabled.current = savedSkillsEnabled;
      const newProfileId = newProfiles.find(
        (p) => !providerProfiles.some((existing) => existing.id === p.id)
      )?.id;

      setProviderProfiles(newProfiles);
      setDefaultProviderProfileId(savedDefaultProviderProfileId);
      setSkillsEnabled(savedSkillsEnabled);
      if (newProfileId) {
        setSelectedProviderProfileId(newProfileId);
        const duplicatedProfile = newProfiles.find((profile) => profile.id === newProfileId);
        resetDirty(
          buildDirtySnapshot(
            duplicatedProfile,
            savedDefaultProviderProfileId,
            savedSkillsEnabled
          )
        );
      }
      setMobileDetailVisible(true);
      toast.showToast("success", "Provider duplicated");
    } catch {
      toast.showToast("error", "Unable to duplicate provider");
    }
  }

  async function buildSettingsPayload(defaultProviderProfileIdOverride?: string, profilesOverride?: ProviderProfileDraft[]) {
    const nextDefaultProviderProfileId = defaultProviderProfileIdOverride ?? defaultProviderProfileId;
    const profilesToSave = profilesOverride ?? providerProfiles;

    return {
      ...settings,
      defaultProviderProfileId: nextDefaultProviderProfileId,
      skillsEnabled,
      providerProfiles: profilesToSave.map(buildProviderProfileInput)
    };
  }

  async function saveSettings() {
    return saveSettingsWithDefault(defaultProviderProfileId);
  }

  async function saveSettingsWithDefault(nextDefaultProviderProfileId: string, profilesOverride?: ProviderProfileDraft[]) {
    try {
      return await saveSettingsWithDefaultUnsafe(nextDefaultProviderProfileId, profilesOverride);
    } catch {
      toast.showToast("error", "Unable to save settings");
      return false;
    }
  }

  async function saveSettingsWithDefaultUnsafe(nextDefaultProviderProfileId: string, profilesOverride?: ProviderProfileDraft[]) {
    const profilesToSave = profilesOverride ?? providerProfiles;
    const response = await fetch("/api/settings/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await buildSettingsPayload(nextDefaultProviderProfileId, profilesToSave))
    });

    const result = (await response.json()) as { settings?: SettingsPayload; error?: string };
    if (!response.ok) {
      toast.showToast("error", result.error ?? "Unable to save settings");
      return false;
    }
    if (!result.settings) {
      throw new Error("Provider settings response was incomplete");
    }

    const persistedProfiles = toProviderDrafts(result.settings.providerProfiles);
    const persistedDefaultId =
      result.settings.defaultProviderProfileId ?? persistedProfiles[0]?.id ?? "";
    const persistedSkills = result.settings.skillsEnabled;
    const persistedSelectedId = persistedProfiles.some(
      (profile) => profile.id === selectedProviderProfileId
    )
      ? selectedProviderProfileId
      : persistedDefaultId;
    persistedProviderProfiles.current = persistedProfiles;
    persistedDefaultProviderProfileId.current = persistedDefaultId;
    persistedSkillsEnabled.current = persistedSkills;
    setProviderProfiles(persistedProfiles);
    setSelectedProviderProfileId(persistedSelectedId);
    setDefaultProviderProfileId(persistedDefaultId);
    setSkillsEnabled(persistedSkills);
    resetDirty(
      buildDirtySnapshot(
        persistedProfiles.find((profile) => profile.id === persistedSelectedId) ?? persistedProfiles[0],
        persistedDefaultId,
        persistedSkills
      )
    );

    return true;
  }

  async function handleSettings(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    toast.dismissToast();

    if (await saveSettings()) {
      toast.showToast("success", "Provider saved.");
      return true;
    }
    return false;
  }

  async function runConnectionTest() {
    setTestResult(null);
    setIsTesting(true);
    try {
      const response = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerProfileId: selectedProviderProfileId })
      });
      const result = (await response.json()) as { text?: string; error?: string };
      const text = result.text ?? result.error ?? "No result";
      setTestResult({ text, isSuccess: response.ok && !result.error });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleToggleDefault() {
    if (!activeProviderProfile || activeProviderProfile.id === defaultProviderProfileId) {
      return;
    }
    toast.dismissToast();
    if (await saveSettingsWithDefault(activeProviderProfile.id)) {
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

  async function handleUnsavedSave() {
    if (!(await saveSettings())) return;
    setUnsavedDialogOpen(false);
    pendingSwitch?.();
    setPendingSwitch(null);
  }

  function handleUnsavedDiscard() {
    setUnsavedDialogOpen(false);
    restorePersistedProviderSettings();
    if (pendingSwitch) {
      pendingSwitch();
      setPendingSwitch(null);
    }
  }

  const providerDetailFooter = activeProviderProfile ? (
    <DetailActionBar
      status={isDirty ? "unsaved" : "saved"}
      leftActions={
        <button
          type="button"
          onClick={() => {
            setPendingDeleteId(activeProviderProfile.id);
            setDeleteConfirmOpen(true);
          }}
          disabled={providerProfiles.length === 1}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-red-400/80 transition-colors hover:bg-red-500/[0.06] hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      }
      rightActions={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={runConnectionTest}
            size="lg"
            disabled={isTesting}
            className="min-h-11 gap-1.5 px-4 text-sm md:min-h-10"
          >
            <Zap className="h-3.5 w-3.5" />
            {isTesting ? "Testing…" : "Test"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleDuplicateProviderProfile}
            size="lg"
            className="min-h-11 gap-1.5 px-4 text-sm md:min-h-10"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={restorePersistedProviderSettings}
            size="lg"
            className="min-h-11 px-4 text-sm md:min-h-10"
          >
            Discard
          </Button>
          <Button
            type="submit"
            form="provider-settings-form"
            size="lg"
            className="min-h-11 px-5 text-sm md:min-h-10"
            disabled={isDuplicateName}
          >
            Save
          </Button>
        </>
      }
    />
  ) : null;


  return (
    <div className="flex min-h-0 w-full flex-1">
      <SettingsSplitPane
        backLabel="Providers"
        detailTitle={activeProviderProfile?.name ?? "Provider"}
        detailFooter={providerDetailFooter}
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
              aria-label="Add provider"
              onClick={() => {
                if (isDirty) {
                  setPendingSwitch(() => () => addProviderProfile(
                    persistedProviderProfiles.current,
                    selectedProviderProfileId
                  ));
                  setUnsavedDialogOpen(true);
                  return;
                }
                addProviderProfile();
              }}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[var(--muted)] transition-colors duration-200 hover:bg-white/[0.07] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:h-9 md:w-9"
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
                  if (isDirty && selectedProviderProfileId !== profile.id) {
                    setPendingSwitch(() => () => {
                      const persistedProfile = persistedProviderProfiles.current.find(
                        (entry) => entry.id === profile.id
                      );
                      setSelectedProviderProfileId(profile.id);
                      setMobileDetailVisible(true);
                      resetDirty(
                        buildDirtySnapshot(
                          persistedProfile ?? profile,
                          persistedDefaultProviderProfileId.current,
                          persistedSkillsEnabled.current
                        )
                      );
                    });
                    setUnsavedDialogOpen(true);
                    return;
                  }
                  setSelectedProviderProfileId(profile.id);
                  setMobileDetailVisible(true);
                  resetDirty(
                    buildDirtySnapshot(profile, defaultProviderProfileId, skillsEnabled)
                  );
                }}
                title={profile.name}
                subtitle={`${PROVIDER_CATALOG[profile.providerKind].label}${profile.model ? ` · ${profile.model}` : ""}${PROVIDER_CATALOG[profile.providerKind].editor.apiMode ? ` · ${getProviderApiMode(profile)}` : ""}`}
                badges={[
                  ...(profile.id === defaultProviderProfileId
                    ? [{ variant: "default" as const, label: "DEFAULT" }]
                    : []),
                  ...(profile.connection.status === "disconnected" && profile.connection.mode === "api_key" && !profile.credential
                    ? [{ variant: "no-key" as const, label: "NO KEY" }]
                    : []),
                  ...(profile.connection.status === "disconnected" && profile.connection.mode === "oauth"
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
            id="provider-settings-form"
            onSubmit={(event) => void handleSettings(event)}
            className="w-full max-w-[840px]"
          >
            {activeProviderProfile ? (
              <div className="space-y-0">
                {/* Header */}
                <DetailHeader
                  title={activeProviderProfile.name}
                  summary={`${PROVIDER_CATALOG[activeProviderProfile.providerKind].label}${getProviderApiBaseUrl(activeProviderProfile) ? ` · ${getProviderApiBaseUrl(activeProviderProfile)}` : ""}${activeProviderProfile.model ? ` · ${activeProviderProfile.model}` : ""}${activeProviderEditor?.apiMode ? ` · ${getProviderApiMode(activeProviderProfile)}` : ""}`}
                  badge={
                    <>
                      {activeProviderProfile.id === defaultProviderProfileId && (
                        <span className="inline-flex items-center rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                          Default
                        </span>
                      )}
                      {activeProviderProfile.connection.status === "disconnected" && activeProviderProfile.connection.mode === "api_key" && !activeProviderProfile.credential && (
                        <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                          No key
                        </span>
                      )}
                      {activeProviderProfile.connection.status === "disconnected" && activeProviderProfile.connection.mode === "oauth" && (
                        <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                          Not connected
                        </span>
                      )}
                    </>
                  }
                />

                <SettingsAccordion
                  title="Identity"
                  description="Name, provider type, and default behavior"
                  defaultOpen
                >
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
                        className={isFieldDirty("activeName") ? "!border-amber-500/40" : ""}
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
                        className={`${selectLike} ${isFieldDirty("activeProviderKind") ? "!border-amber-500/40" : ""}`}
                        value={activeProviderProfile.providerKind}
                        onChange={(event) => {
                          const value = event.target.value as ProviderKind;
                          replaceActiveProviderProfile(
                            switchProviderProfileKind(activeProviderProfile, value)
                          );
                        }}
                      >
                        {Object.entries(PROVIDER_CATALOG).map(([kind, provider]) => (
                          <option key={kind} value={kind}>{provider.label}</option>
                        ))}
                      </select>
                    </div>
                    {PROVIDER_PRESETS.some((preset) => preset.providerKind === activeProviderProfile.providerKind) && (
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
                          {PROVIDER_PRESETS.filter(
                            (preset) => preset.providerKind === activeProviderProfile.providerKind
                          ).map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </SettingsAccordion>

                <SettingsAccordion
                  title="Connection"
                  description="Credentials, endpoint, and model"
                  defaultOpen
                >
                  <ProviderConnectionFields
                    profile={activeProviderProfile}
                    models={discoveredModels}
                    dirty={isFieldDirty("activeProviderConfig") || isFieldDirty("activeCredential") || isFieldDirty("activeModel")}
                    onChange={replaceActiveProviderProfile}
                    onSave={saveSettings}
                    onError={(message) => toast.showToast("error", message)}
                  />
                </SettingsAccordion>

                <SettingsAccordion
                  title="Configuration"
                  description="Reasoning, context, compaction, and vision"
                >
                  <div className="flex items-center justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetActiveProviderAdvancedSettings}
                      size="lg"
                      className="px-3 text-xs"
                    >
                      Reset defaults
                    </Button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                    {activeProviderEditor?.sampling && (
                      <>
                        {activeProviderCapabilities?.supportsTemperature ? (
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
                              className={isFieldDirty("activeTemperature") ? "!border-amber-500/40" : ""}
                            />
                          </div>
                        ) : null}
                        <div>
                          <label className={fieldLabel}>Max output tokens</label>
                          <Input
                            name="provider-max-output-tokens"
                            type="number"
                            value={activeProviderProfile.maxOutputTokens}
                            onChange={(event) =>
                              updateActiveProviderProfile({ maxOutputTokens: Number(event.target.value || 0) })
                            }
                            className={isFieldDirty("activeMaxOutputTokens") ? "!border-amber-500/40" : ""}
                          />
                          {activeProviderCapabilities?.outputTokenBudgetIncludesReasoning ? (
                            <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                              This limit includes reasoning and visible output tokens.
                            </p>
                          ) : null}
                        </div>
                      </>
                    )}
                    {usesThinkingToggle ? (
                      <div>
                        <label className={fieldLabel}>Thinking</label>
                        <label className={`flex h-[42px] items-center gap-3 rounded-lg border bg-white/[0.03] px-3 text-sm text-[var(--muted)] cursor-pointer ${isFieldDirty("activeReasoningEffort") || isFieldDirty("activeReasoningSummaryEnabled") ? "!border-amber-500/40" : "border-white/[0.06]"}`}>
                          <input
                            type="checkbox"
                            checked={activeProviderProfile.reasoningEffort !== "none"}
                            onChange={(event) => {
                              const thinkingOn = event.target.checked;
                              updateActiveProviderProfile({
                                reasoningEffort: thinkingOn ? "medium" : "none",
                                ...(thinkingOn ? { reasoningSummaryEnabled: true } : {})
                              });
                            }}
                          />
                          Enable thinking mode
                        </label>
                      </div>
                    ) : (
                      <div>
                        <label className={fieldLabel}>Reasoning effort</label>
                        <select
                          value={activeProviderProfile.reasoningEffort}
                          onChange={(event) =>
                            updateActiveProviderProfile({ reasoningEffort: event.target.value as ReasoningEffort })
                          }
                          className={`${selectLike} ${isFieldDirty("activeReasoningEffort") ? "!border-amber-500/40" : ""}`}
                        >
                          {(activeProviderCapabilities?.reasoningEfforts ?? []).map((effort) => (
                            <option key={effort} value={effort}>
                              {effort === "none" ? "disabled" : effort}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {activeProviderEditor?.sampling && (
                      <>
                        {activeProviderEditor.apiMode && (
                          <div>
                            <label className={fieldLabel}>API mode</label>
                            <select
                              value={getProviderApiMode(activeProviderProfile)}
                              onChange={(event) => replaceActiveProviderProfile(
                                setProviderApiMode(
                                  activeProviderProfile,
                                  event.target.value as "responses" | "chat_completions"
                                )
                              )}
                              className={`${selectLike} ${isFieldDirty("activeProviderConfig") ? "!border-amber-500/40" : ""}`}
                            >
                              <option value="responses">responses</option>
                              <option value="chat_completions">chat_completions</option>
                            </select>
                          </div>
                        )}
                        {activeProviderCapabilities?.processingModes.length ? (
                          <div>
                            <label className={fieldLabel}>Processing mode</label>
                            <select
                              name="provider-processing-mode"
                              value={getProviderProcessingMode(activeProviderProfile)}
                              onChange={(event) => replaceActiveProviderProfile(
                                setProviderProcessingMode(
                                  activeProviderProfile,
                                  event.target.value as "standard" | "fast"
                                )
                              )}
                              className={`${selectLike} ${isFieldDirty("activeProviderConfig") ? "!border-amber-500/40" : ""}`}
                            >
                              <option value="standard">Standard</option>
                              <option value="fast">Fast</option>
                            </select>
                            <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                              Fast uses lower-latency processing at a per-token premium and does not support long-context requests.
                            </p>
                          </div>
                        ) : null}
                        {activeProviderProfile.reasoningEffort !== "none" && !usesThinkingToggle && (
                        <div>
                          <label className={fieldLabel}>Reasoning summary</label>
                          <label className={`flex h-[42px] items-center gap-3 rounded-lg border bg-white/[0.03] px-3 text-sm text-[var(--muted)] cursor-pointer ${isFieldDirty("activeReasoningSummaryEnabled") ? "!border-amber-500/40" : "border-white/[0.06]"}`}>
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
                        )}
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
                            className={isFieldDirty("activeModelContextLimit") ? "!border-amber-500/40" : ""}
                          />
                          {activeProviderCapabilities?.longContextPricingThreshold ? (
                            <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                              Long-context pricing applies above {activeProviderCapabilities.longContextPricingThreshold.toLocaleString()} input tokens.
                            </p>
                          ) : null}
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
                            className={isFieldDirty("activeCompactionThreshold") ? "!border-amber-500/40" : ""}
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
                            className={isFieldDirty("activeFreshTailCount") ? "!border-amber-500/40" : ""}
                          />
                    </div>
                    {activeProviderEditor?.tokenization && (
                      <>
                        <div>
                          <label className={fieldLabel}>Tokenizer model</label>
                          <select
                            value={activeProviderProfile.tokenizerModel}
                            onChange={(event) =>
                              updateActiveProviderProfile({ tokenizerModel: event.target.value as "gpt-tokenizer" | "off" })
                            }
                             className={`${selectLike} ${isFieldDirty("activeTokenizerModel") ? "!border-amber-500/40" : ""}`}
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
                            className={isFieldDirty("activeSafetyMarginTokens") ? "!border-amber-500/40" : ""}
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
                            className={isFieldDirty("activeLeafSourceTokenLimit") ? "!border-amber-500/40" : ""}
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
                            className={isFieldDirty("activeLeafMinMessageCount") ? "!border-amber-500/40" : ""}
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
                            className={isFieldDirty("activeMergedMinNodeCount") ? "!border-amber-500/40" : ""}
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
                            className={isFieldDirty("activeMergedTargetTokens") ? "!border-amber-500/40" : ""}
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
                         className={`${selectLike} ${isFieldDirty("activeVisionMode") ? "!border-amber-500/40" : ""}`}
                       >
                        <option value="native">native</option>
                        <option value="none">none</option>
                        <option value="mcp">mcp</option>
                        <option value="provider">other provider</option>
                      </select>
                    </div>
                    {activeProviderProfile.visionMode === "provider" && (
                      <div>
                        <label className={fieldLabel}>Vision provider</label>
                        <select
                          value={activeProviderProfile.visionProviderProfileId ?? ""}
                          onChange={(event) =>
                            updateActiveProviderProfile({
                              visionProviderProfileId: event.target.value || null
                            })
                          }
                          className={`${selectLike} ${isFieldDirty("activeVisionProviderProfileId") ? "!border-amber-500/40" : ""}`}
                        >
                          <option value="">Select a profile…</option>
                          {visionCapableProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name} · {profile.model}
                            </option>
                          ))}
                        </select>
                        {visionCapableProfiles.length === 0 && (
                          <p className="mt-1.5 text-xs text-amber-400">
                            No other profile has a vision-capable model. Configure another
                            profile with a vision model, or choose a different vision mode.
                          </p>
                        )}
                      </div>
                    )}
                    {activeProviderProfile.visionMode === "mcp" &&
                      !mcpServers.some((server) => server.enabled && server.isVisionMcp) && (
                        <p className="mt-1.5 text-xs text-amber-400">
                          No MCP server is marked as a Vision MCP. Images won&apos;t be analyzed
                          until you enable one in the MCP servers settings.
                        </p>
                      )}
                  </div>
                </SettingsAccordion>

                <SettingsAccordion
                  title="System instructions"
                  description="Persistent guidance for this provider profile"
                >
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
                        className={`cursor-pointer rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--muted)] line-clamp-3 hover:bg-white/[0.06] transition-colors ${isFieldDirty("activeSystemPrompt") ? "border-amber-500/40" : "border-white/6"}`}
                      >
                        {activeProviderProfile.systemPrompt || "No system prompt set"}
                      </div>
                    </div>
                    <label className={`flex items-center gap-3 rounded-lg border bg-white/[0.03] px-3 py-2.5 text-sm text-[var(--muted)] cursor-pointer ${isFieldDirty("skillsEnabled") ? "!border-amber-500/40" : "border-white/[0.06]"}`}>
                      <input
                        type="checkbox"
                        checked={skillsEnabled}
                        onChange={(event) => setSkillsEnabled(event.target.checked)}
                      />
                      Make enabled skills available to every chat in this workspace
                    </label>
                  </div>
                </SettingsAccordion>

                {/* Messages */}
                {testResult ? (
                  <p className={`pt-2 text-sm ${testResult.isSuccess ? "text-emerald-400" : "text-red-300"}`}>
                    {testResult.text}
                  </p>
                ) : null}

                <UnsavedChangesDialog
                  open={unsavedDialogOpen}
                  onOpenChange={setUnsavedDialogOpen}
                  entityType="your provider settings"
                  onSave={handleUnsavedSave}
                  onDiscard={handleUnsavedDiscard}
                />

                <ConfirmDialog
                  open={deleteConfirmOpen}
                  onOpenChange={setDeleteConfirmOpen}
                  title="Delete provider?"
                  description={
                    <>
                      <strong className="text-[var(--text)] font-medium">{activeProviderProfile?.name || "This provider"}</strong> will be permanently deleted. Conversations and scheduled automations using it will move to the default provider, and title generation will return to the conversation provider.
                    </>
                  }
                  onConfirm={handleDeleteConfirm}
                />

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
