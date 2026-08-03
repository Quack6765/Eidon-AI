"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  buildIntegrationUpdate,
  createGeneralSettingsDraft,
  draftCredentials,
  type GeneralSettingsDraft
} from "@/components/settings/integration-settings/general-settings-draft";
import { ImageGenerationSettings } from "@/components/settings/integration-settings/image-generation-settings";
import { SpeechTranscriptionSettings } from "@/components/settings/integration-settings/speech-transcription-settings";
import { WebSearchSettings } from "@/components/settings/integration-settings/web-search-settings";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useToastState } from "@/hooks/use-toast-state";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { getImageGenerationReadinessError } from "@/lib/image-generation/catalog";
import { fieldLabel, sectionDivider, sectionTitle, selectLike } from "@/lib/settings-styles";
import { getTranscriptionReadinessError } from "@/lib/speech/transcription-catalog";
import type { AppSettings, ConversationRetention } from "@/lib/types";
import { getWebSearchReadinessError } from "@/lib/web-search-catalog";

type GeneralSectionSettings = AppSettings & {
  providerProfiles: Array<{ id: string; name: string; model: string }>;
};

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
    if (draft.webSearch.providerId !== "disabled") {
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
    return getTranscriptionReadinessError({
      ...draft.speechTranscription,
      credentials: draftCredentials(draft.speechTranscription)
    });
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
          webSearch: buildIntegrationUpdate(draft.webSearch),
          speechTranscription: buildIntegrationUpdate(draft.speechTranscription),
          ...(canManageGlobalIntegrations
            ? {
                imageGeneration: buildIntegrationUpdate(draft.imageGeneration),
                titleGeneration: {
                  titleGenerationMode: draft.titleGeneration.titleGenerationMode,
                  titleGenerationProfileId:
                    draft.titleGeneration.titleGenerationMode === "specific"
                      ? draft.titleGeneration.titleGenerationProfileId
                      : null
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

  return (
    <div className="w-full max-w-none space-y-6 p-4 sm:p-6 md:max-w-[55%] md:p-8">
      <div className="space-y-4">
        <h3 className={sectionTitle}>Conversation Retention</h3>
        <div className="space-y-1.5">
          <label htmlFor="conversation-retention" className={fieldLabel}>Keep conversations for</label>
          <p className="text-xs text-[var(--muted)]">Older conversations will be automatically deleted.</p>
          <select
            id="conversation-retention"
            value={draft.preferences.conversationRetention}
            onChange={(event) => updateDraft("preferences", {
              ...draft.preferences,
              conversationRetention: event.target.value as ConversationRetention
            })}
            className={`${selectLike} sm:w-auto ${preferencesDirty ? "!border-amber-500/40" : ""}`}
          >
            <option value="forever">Forever</option>
            <option value="90d">90 days</option>
            <option value="30d">30 days</option>
            <option value="7d">7 days</option>
          </select>
        </div>
      </div>

      <div className={sectionDivider} />

      <div className="space-y-4">
        <h3 className={sectionTitle}>Agent Limits</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="mcp-timeout" className={fieldLabel}>Max tool call timeout</label>
            <p className="mb-2 text-xs text-[var(--muted)]">Maximum time for an MCP tool call.</p>
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
            <p className="mb-2 text-xs text-[var(--muted)]">Maximum actions in one assistant turn.</p>
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
      </div>

      <div className={sectionDivider} />

      <div className="space-y-4">
        <h3 className={sectionTitle}>Speech-to-Text</h3>
        <SpeechTranscriptionSettings
          draft={draft.speechTranscription}
          persisted={persistedDraft.current.speechTranscription}
          dirty={isFieldDirty("speechTranscription")}
          onChange={(value) => updateDraft("speechTranscription", value)}
        />
      </div>

      <div className={sectionDivider} />

      <div className="space-y-4">
        <h3 className={sectionTitle}>Web Search</h3>
        <WebSearchSettings
          draft={draft.webSearch}
          persisted={persistedDraft.current.webSearch}
          dirty={isFieldDirty("webSearch")}
          onChange={(value) => updateDraft("webSearch", value)}
        />
      </div>

      <div className={sectionDivider} />

      <div className="space-y-4">
        <h3 className={sectionTitle}>Image Generation</h3>
        <ImageGenerationSettings
          draft={draft.imageGeneration}
          persisted={persistedDraft.current.imageGeneration}
          canManage={canManageGlobalIntegrations}
          dirty={isFieldDirty("imageGeneration")}
          onChange={(value) => updateDraft("imageGeneration", value)}
        />
      </div>

      <div className={sectionDivider} />

      <div className="space-y-4">
        <h3 className={sectionTitle}>Title Generation</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="title-generation-mode" className={fieldLabel}>Title generation mode</label>
            <p className="mb-2 text-xs text-[var(--muted)]">
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isDirty ? (
          <span className="text-xs text-amber-400/80"><span>●</span> Unsaved changes</span>
        ) : null}
        <Button className="px-3 py-1.5 text-xs" onClick={() => void save()} disabled={isSaving}>
          Save
        </Button>
      </div>
      <Toast visible={toast.visible} variant={toast.variant} message={toast.message} />
    </div>
  );
}
