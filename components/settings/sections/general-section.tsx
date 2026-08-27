"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Gauge, Image as ImageIcon, Mic2, Search, Type } from "lucide-react";

import {
  buildIntegrationUpdate,
  createGeneralSettingsDraft,
  draftCredentials,
  type GeneralSettingsDraft
} from "@/components/settings/integration-settings/general-settings-draft";
import { DetailActionBar } from "@/components/settings/detail-action-bar";
import { DetailHeader } from "@/components/settings/detail-header";
import { ImageGenerationSettings } from "@/components/settings/integration-settings/image-generation-settings";
import { SpeechTranscriptionSettings } from "@/components/settings/integration-settings/speech-transcription-settings";
import { WebSearchSettings } from "@/components/settings/integration-settings/web-search-settings";
import { SettingsMenuItem } from "@/components/settings/settings-menu-item";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useToastState } from "@/hooks/use-toast-state";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { getImageGenerationReadinessError } from "@/lib/image-generation/catalog";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import { getTranscriptionReadinessError } from "@/lib/speech/transcription-catalog";
import type { AppSettings, ConversationRetention, ToolCallDisplayMode } from "@/lib/types";
import { getWebSearchReadinessError } from "@/lib/web-search-catalog";

type GeneralSectionSettings = AppSettings & {
  providerProfiles: Array<{ id: string; name: string; model: string }>;
};

const GENERAL_SECTIONS = [
  {
    id: "conversation",
    label: "Conversation",
    description: "Retention and links",
    detail: "Choose how long Eidon keeps conversations and how links open.",
    icon: Archive
  },
  {
    id: "agent-limits",
    label: "Agent limits",
    description: "Tool timeouts and steps",
    detail: "Set the boundaries for tool calls and multi-step assistant work.",
    icon: Gauge
  },
  {
    id: "speech",
    label: "Speech-to-text",
    description: "Dictation engine and language",
    detail: "Configure how spoken drafts are transcribed before they are sent.",
    icon: Mic2
  },
  {
    id: "web-search",
    label: "Web search",
    description: "Search provider and access",
    detail: "Choose the service Eidon uses when a task needs current web information.",
    icon: Search
  },
  {
    id: "image-generation",
    label: "Image generation",
    description: "Image model and credentials",
    detail: "Configure the image service available to conversations in this workspace.",
    icon: ImageIcon
  },
  {
    id: "title-generation",
    label: "Title generation",
    description: "Conversation naming",
    detail: "Choose which model creates concise titles for new conversations.",
    icon: Type
  }
] as const;

type GeneralSectionId = (typeof GENERAL_SECTIONS)[number]["id"];

export function GeneralSection({
  settings,
  canManageGlobalIntegrations = false
}: {
  settings: GeneralSectionSettings;
  canManageGlobalIntegrations?: boolean;
}) {
  const router = useRouter();
  const toast = useToastState();
  const initialDraft = createGeneralSettingsDraft(settings);
  const [draft, setDraft] = useState(initialDraft);
  const [activeSection, setActiveSection] = useState<GeneralSectionId>("conversation");
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const persistedDraft = useRef(initialDraft);
  const [isSaving, setIsSaving] = useState(false);
  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState(draft);

  useEffect(() => {
    const next = createGeneralSettingsDraft(settings);
    persistedDraft.current = next;
    setDraft(next);
    resetDirty(next);
  }, [settings, resetDirty]);

  useUnsavedChangesGuard({
    isDirty,
    save,
    discard: restoreSavedSettings,
    entityType: "these settings"
  });

  function updateDraft<Key extends keyof GeneralSettingsDraft>(
    key: Key,
    value: GeneralSettingsDraft[Key]
  ) {
    toast.dismissToast();
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function restoreSavedSettings() {
    const restored = persistedDraft.current;
    setDraft(restored);
    resetDirty(restored);
    toast.dismissToast();
  }

  function getValidationError() {
    if (canManageGlobalIntegrations && draft.speechCleanup.enabled) {
      if (!settings.providerProfiles.length) {
        return "Create a provider profile before enabling AI post-cleanup.";
      }
      if (!draft.speechCleanup.profileId) {
        return "Select a provider profile for AI post-cleanup.";
      }
      if (!draft.speechCleanup.prompt.trim()) {
        return "AI post-cleanup prompt cannot be empty.";
      }
    }
    if (canManageGlobalIntegrations && draft.webSearch.providerId !== "disabled") {
      const error = getWebSearchReadinessError({
        ...draft.webSearch,
        credentials: draftCredentials(draft.webSearch)
      });
      if (error) return error;
    }
    if (canManageGlobalIntegrations && draft.imageGeneration.providerId !== "disabled") {
      const clearingStoredCredential = draft.imageGeneration.credentialStored &&
        draft.imageGeneration.credentialAction === "clear";
      if (!clearingStoredCredential) {
        const error = getImageGenerationReadinessError({
          ...draft.imageGeneration,
          credentials: draftCredentials(draft.imageGeneration)
        });
        if (error) return error;
      }
    }
    return canManageGlobalIntegrations
      ? getTranscriptionReadinessError({
          ...draft.speechTranscription,
          credentials: draftCredentials(draft.speechTranscription)
        })
      : null;
  }

  async function save(): Promise<boolean> {
    toast.dismissToast();
    const validationError = getValidationError();
    if (validationError) {
      toast.showToast("error", validationError);
      return false;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: draft.preferences,
          ...(canManageGlobalIntegrations
            ? {
                webSearch: buildIntegrationUpdate(draft.webSearch),
                speechTranscription: buildIntegrationUpdate(draft.speechTranscription),
                imageGeneration: buildIntegrationUpdate(draft.imageGeneration),
                titleGeneration: {
                  titleGenerationMode: draft.titleGeneration.titleGenerationMode,
                  titleGenerationProfileId:
                    draft.titleGeneration.titleGenerationMode === "specific"
                      ? draft.titleGeneration.titleGenerationProfileId
                      : null
                },
                speechCleanup: {
                  enabled: draft.speechCleanup.enabled,
                  profileId: draft.speechCleanup.profileId,
                  prompt: draft.speechCleanup.prompt
                }
              }
            : {})
        })
      });
      const result = await response.json() as {
        settings?: GeneralSectionSettings;
        error?: string;
      };
      if (!response.ok || !result.settings) {
        toast.showToast("error", result.error ?? "Unable to save settings");
        return false;
      }

      const saved = createGeneralSettingsDraft(result.settings);
      persistedDraft.current = saved;
      setDraft(saved);
      resetDirty(saved);
      toast.showToast("success", "Settings saved.");
      router.refresh();
      return true;
    } catch {
      toast.showToast("error", "Unable to save settings");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  const preferencesDirty = isFieldDirty("preferences");
  const titleGenerationDirty = isFieldDirty("titleGeneration");
  const activeSectionDefinition = GENERAL_SECTIONS.find((section) => section.id === activeSection) ?? GENERAL_SECTIONS[0];

  const detailContent = {
    conversation: (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <label htmlFor="conversation-retention" className={fieldLabel}>Keep conversations for</label>
          <p className="text-xs leading-5 text-[var(--muted)]">Older conversations will be automatically deleted.</p>
          <select
            id="conversation-retention"
            value={draft.preferences.conversationRetention}
            onChange={(event) => updateDraft("preferences", {
              ...draft.preferences,
              conversationRetention: event.target.value as ConversationRetention
            })}
            className={`${selectLike} mt-2 sm:w-auto ${preferencesDirty ? "!border-amber-500/40" : ""}`}
          >
            <option value="forever">Forever</option>
            <option value="90d">90 days</option>
            <option value="30d">30 days</option>
            <option value="7d">7 days</option>
          </select>
        </div>
        <label htmlFor="confirm-external-links" className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] cursor-pointer sm:max-w-md">
          <input
            id="confirm-external-links"
            type="checkbox"
            checked={draft.preferences.confirmExternalLinks}
            onChange={(event) => updateDraft("preferences", {
              ...draft.preferences,
              confirmExternalLinks: event.target.checked
            })}
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium">Ask before opening external links</span>
            <span className="text-xs leading-5 text-[var(--muted)]">When on, tapping a link shows a confirmation. When off, links open immediately.</span>
          </span>
        </label>
        <div className="space-y-1.5">
          <label htmlFor="tool-call-display" className={fieldLabel}>Tool activity display</label>
          <p className="text-xs leading-5 text-[var(--muted)]">Show a pill for each tool as it runs, or collapse all activity into one animated status line.</p>
          <select
            id="tool-call-display"
            value={draft.preferences.toolCallDisplay}
            onChange={(event) => updateDraft("preferences", {
              ...draft.preferences,
              toolCallDisplay: event.target.value as ToolCallDisplayMode
            })}
            className={`${selectLike} mt-2 sm:w-auto ${preferencesDirty ? "!border-amber-500/40" : ""}`}
          >
            <option value="pills">Tool pills</option>
            <option value="status_line">Single status line</option>
          </select>
        </div>
      </div>
    ),
    "agent-limits": (
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="mcp-timeout" className={fieldLabel}>Max tool call timeout</label>
          <p className="mb-2 text-xs leading-5 text-[var(--muted)]">Maximum time for an MCP tool call.</p>
          <input
            id="mcp-timeout"
            type="number"
            min={1}
            value={draft.preferences.mcpTimeout / 1000}
            onChange={(event) => updateDraft("preferences", {
              ...draft.preferences,
              mcpTimeout: Number(event.target.value) * 1000
            })}
            className={`${selectLike} w-full ${preferencesDirty ? "!border-amber-500/40" : ""}`}
          />
        </div>
        <div>
          <label htmlFor="max-tool-steps" className={fieldLabel}>Maximum tool steps</label>
          <p className="mb-2 text-xs leading-5 text-[var(--muted)]">Maximum actions in one assistant turn.</p>
          <input
            id="max-tool-steps"
            type="number"
            min={1}
            max={1000}
            value={draft.preferences.maxAssistantToolSteps}
            onChange={(event) => updateDraft("preferences", {
              ...draft.preferences,
              maxAssistantToolSteps: Number(event.target.value)
            })}
            className={`${selectLike} w-full ${preferencesDirty ? "!border-amber-500/40" : ""}`}
          />
        </div>
      </div>
    ),
    speech: (
      <SpeechTranscriptionSettings
        draft={draft.speechTranscription}
        persisted={persistedDraft.current.speechTranscription}
        canManage={canManageGlobalIntegrations}
        dirty={isFieldDirty("speechTranscription")}
        onChange={(value) => updateDraft("speechTranscription", value)}
        cleanup={draft.speechCleanup}
        cleanupDirty={isFieldDirty("speechCleanup")}
        providerProfiles={settings.providerProfiles}
        onCleanupChange={(value) => updateDraft("speechCleanup", value)}
      />
    ),
    "web-search": (
      <WebSearchSettings
        draft={draft.webSearch}
        persisted={persistedDraft.current.webSearch}
        canManage={canManageGlobalIntegrations}
        dirty={isFieldDirty("webSearch")}
        onChange={(value) => updateDraft("webSearch", value)}
      />
    ),
    "image-generation": (
      <ImageGenerationSettings
        draft={draft.imageGeneration}
        persisted={persistedDraft.current.imageGeneration}
        canManage={canManageGlobalIntegrations}
        dirty={isFieldDirty("imageGeneration")}
        onChange={(value) => updateDraft("imageGeneration", value)}
      />
    ),
    "title-generation": (
      <div className="space-y-4">
        <div>
          <label htmlFor="title-generation-mode" className={fieldLabel}>Title generation mode</label>
          <p className="mb-2 text-xs leading-5 text-[var(--muted)]">
            {canManageGlobalIntegrations ? "Choose which AI generates conversation titles." : "Only admins can change title generation settings."}
          </p>
          <select
            id="title-generation-mode"
            aria-label="Title generation mode"
            value={draft.titleGeneration.titleGenerationMode}
            disabled={!canManageGlobalIntegrations}
            onChange={(event) => {
              const titleGenerationMode = event.target.value as AppSettings["titleGenerationMode"];
              updateDraft("titleGeneration", {
                titleGenerationMode,
                titleGenerationProfileId:
                  titleGenerationMode === "specific"
                    ? draft.titleGeneration.titleGenerationProfileId ?? settings.providerProfiles[0]?.id ?? null
                    : null
              });
            }}
            className={`${selectLike} w-full sm:w-[22rem] ${!canManageGlobalIntegrations ? "opacity-60" : ""} ${titleGenerationDirty ? "!border-amber-500/40" : ""}`}
          >
            <option value="local">Local model</option>
            <option value="same">Same as conversation</option>
            <option value="specific">Specific provider</option>
          </select>
        </div>
        {canManageGlobalIntegrations && draft.titleGeneration.titleGenerationMode === "specific" ? (
          settings.providerProfiles.length ? (
            <div>
              <label htmlFor="title-generation-profile" className={fieldLabel}>Provider profile</label>
              <select
                id="title-generation-profile"
                value={draft.titleGeneration.titleGenerationProfileId ?? ""}
                onChange={(event) => updateDraft("titleGeneration", {
                  ...draft.titleGeneration,
                  titleGenerationProfileId: event.target.value || null
                })}
                className={`${selectLike} w-full sm:w-[22rem] ${titleGenerationDirty ? "!border-amber-500/40" : ""}`}
              >
                {settings.providerProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name} ({profile.model})</option>
                ))}
              </select>
            </div>
          ) : <p className="text-xs text-[var(--muted)]">Create a provider profile first.</p>
        ) : null}
      </div>
    )
  } satisfies Record<GeneralSectionId, React.ReactNode>;

  return (
    <div className="flex min-h-0 w-full flex-1">
      <SettingsSplitPane
        listHeader={
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">General</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Preferences and integrations</p>
          </div>
        }
        listPanel={GENERAL_SECTIONS.map((section) => (
          <SettingsMenuItem
            key={section.id}
            icon={section.icon}
            title={section.label}
            description={section.description}
            isActive={section.id === activeSection}
            onClick={() => {
              setActiveSection(section.id);
              setMobileDetailVisible(true);
            }}
          />
        ))}
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        backLabel="General"
        detailTitle={activeSectionDefinition.label}
        detailPanel={
          <div className="w-full max-w-[760px]">
            <div className="mb-8">
              <DetailHeader
                divided
                title={activeSectionDefinition.label}
                summary={activeSectionDefinition.detail}
              />
            </div>
            {GENERAL_SECTIONS.map((section) => (
              <div key={section.id} className={section.id === activeSection ? "block" : "hidden"}>
                {detailContent[section.id]}
              </div>
            ))}
          </div>
        }
        detailFooter={
          <DetailActionBar
            status={isDirty ? "unsaved" : "saved"}
            rightActions={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="min-h-11 px-4 text-sm md:min-h-10"
                  onClick={restoreSavedSettings}
                >
                  Discard
                </Button>
                <Button
                  size="lg"
                  className="min-h-11 min-w-32 px-5 text-sm md:min-h-10"
                  onClick={() => void save()}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </>
            }
          />
        }
      />
      <Toast visible={toast.visible} variant={toast.variant} message={toast.message} />
    </div>
  );
}
