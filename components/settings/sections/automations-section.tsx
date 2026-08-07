"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock3, Plus, Trash2 } from "lucide-react";

import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
import { DetailActionBar } from "@/components/settings/detail-action-bar";
import { DetailHeader } from "@/components/settings/detail-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { fieldLabel, selectLike, sectionTitle } from "@/lib/settings-styles";
import { useToastState } from "@/hooks/use-toast-state";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { Automation, Persona } from "@/lib/types";

type SettingsPayload = {
  defaultProviderProfileId: string | null;
  providerProfiles: Array<{
    id: string;
    name: string;
  }>;
};

type AutomationFormState = {
  name: string;
  prompt: string;
  providerProfileId: string;
  personaId: string | null;
  scheduleKind: "interval" | "calendar";
  intervalMinutes: number;
  calendarFrequency: "daily" | "weekly";
  timeOfDay: string;
  daysOfWeek: number[];
  enabled: boolean;
};

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
] as const;

function createDefaultForm(providerProfileId = ""): AutomationFormState {
  return {
    name: "",
    prompt: "",
    providerProfileId,
    personaId: null,
    scheduleKind: "interval",
    intervalMinutes: 5,
    calendarFrequency: "daily",
    timeOfDay: "09:00",
    daysOfWeek: [1],
    enabled: true
  };
}

function describeSchedule(automation: Automation) {
  if (automation.scheduleKind === "interval" && automation.intervalMinutes) {
    return `Every ${automation.intervalMinutes} min`;
  }

  if (automation.calendarFrequency === "weekly") {
    const selectedDays = WEEKDAYS.filter((day) => automation.daysOfWeek.includes(day.value)).map((day) => day.label);
    return `${selectedDays.join(", ")} at ${automation.timeOfDay ?? "--:--"}`;
  }

  return `Daily at ${automation.timeOfDay ?? "--:--"}`;
}

function automationToForm(automation: Automation): AutomationFormState {
  return {
    name: automation.name,
    prompt: automation.prompt,
    providerProfileId: automation.providerProfileId,
    personaId: automation.personaId,
    scheduleKind: automation.scheduleKind,
    intervalMinutes: automation.intervalMinutes ?? 5,
    calendarFrequency: automation.calendarFrequency ?? "daily",
    timeOfDay: automation.timeOfDay ?? "09:00",
    daysOfWeek: automation.daysOfWeek.length ? automation.daysOfWeek : [1],
    enabled: automation.enabled
  };
}

export function AutomationsSection() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [providerProfiles, setProviderProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [defaultProviderProfileId, setDefaultProviderProfileId] = useState("");
  const [form, setForm] = useState<AutomationFormState>(createDefaultForm());
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const toast = useToastState();
  const showAutomationToast = toast.showToast;
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState(form);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);

  useUnsavedChangesGuard({
    isDirty,
    save: saveAutomation,
    discard: restoreAutomationDraft,
    entityType: "this automation"
  });

  async function loadData() {
    setIsLoading(true);

    try {
      const [automationsResponse, settingsResponse, personasResponse] = await Promise.all([
        fetch("/api/automations"),
        fetch("/api/settings"),
        fetch("/api/personas")
      ]);

      if (!automationsResponse.ok || !settingsResponse.ok || !personasResponse.ok) {
        throw new Error("Unable to load automation settings");
      }

      const automationsPayload = (await automationsResponse.json()) as { automations?: Automation[] };
      const settingsPayload = (await settingsResponse.json()) as { settings?: SettingsPayload };
      const personasPayload = (await personasResponse.json()) as { personas?: Persona[] };

      if (
        !Array.isArray(automationsPayload.automations) ||
        !settingsPayload.settings ||
        !Array.isArray(settingsPayload.settings.providerProfiles) ||
        !Array.isArray(personasPayload.personas)
      ) {
        throw new Error("Automation settings response was incomplete");
      }

      const nextAutomations = automationsPayload.automations;
      const nextProfiles = settingsPayload.settings.providerProfiles;
      const nextDefaultProviderProfileId =
        settingsPayload.settings.defaultProviderProfileId || nextProfiles[0]?.id || "";

      setAutomations(nextAutomations);
      setProviderProfiles(nextProfiles);
      setDefaultProviderProfileId(nextDefaultProviderProfileId);
      setPersonas(personasPayload.personas);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData().catch(() => {
      showAutomationToast("error", "Unable to load automations");
    });
  }, [showAutomationToast]);

  useEffect(() => {
    if (!isAddingNew || form.providerProfileId) {
      return;
    }

    const resolvedProviderProfileId = defaultProviderProfileId || providerProfiles[0]?.id || "";
    if (!resolvedProviderProfileId) {
      return;
    }

    setForm((current) => ({
      ...current,
      providerProfileId: resolvedProviderProfileId
    }));
  }, [defaultProviderProfileId, form.providerProfileId, isAddingNew, providerProfiles]);

  function openAutomation(automation: Automation) {
    if (isDirty && selectedAutomationId !== automation.id) {
      setPendingSwitch(() => () => selectAutomation(automation));
      setUnsavedDialogOpen(true);
      return;
    }
    selectAutomation(automation);
  }

  function selectAutomation(automation: Automation) {
    setSelectedAutomationId(automation.id);
    setIsAddingNew(false);
    setForm(automationToForm(automation));
    toast.dismissToast();
    setMobileDetailVisible(true);
    resetDirty(automationToForm(automation));
  }

  function openNewAutomation() {
    if (isDirty) {
      setPendingSwitch(() => () => newAutomation());
      setUnsavedDialogOpen(true);
      return;
    }
    newAutomation();
  }

  function newAutomation() {
    setSelectedAutomationId(null);
    setIsAddingNew(true);
    const defaults = createDefaultForm(defaultProviderProfileId || providerProfiles[0]?.id || "");
    setForm(defaults);
    toast.dismissToast();
    setMobileDetailVisible(true);
    resetDirty(defaults);
  }

  function resetSelection() {
    setSelectedAutomationId(null);
    setIsAddingNew(false);
    toast.dismissToast();
    setMobileDetailVisible(false);
    const defaults = createDefaultForm(defaultProviderProfileId || providerProfiles[0]?.id || "");
    setForm(defaults);
    resetDirty(defaults);
  }

  function toggleWeekday(day: number) {
    setForm((current) => {
      const hasDay = current.daysOfWeek.includes(day);
      const nextDays = hasDay
        ? current.daysOfWeek.filter((value) => value !== day)
        : [...current.daysOfWeek, day].sort((left, right) => left - right);

      return {
        ...current,
        daysOfWeek: nextDays
      };
    });
  }

  function restoreAutomationDraft() {
    const saved = automations.find((automation) => automation.id === selectedAutomationId);
    const restored = saved
      ? automationToForm(saved)
      : createDefaultForm(defaultProviderProfileId || providerProfiles[0]?.id || "");
    setForm(restored);
    resetDirty(restored);
  }

  async function saveAutomation(): Promise<boolean> {
    const resolvedProviderProfileId = form.providerProfileId || defaultProviderProfileId || providerProfiles[0]?.id || "";

    if (!form.name.trim() || !form.prompt.trim()) {
      toast.showToast("error", "Name and prompt are required");
      return false;
    }

    if (!resolvedProviderProfileId) {
      toast.showToast("error", "Choose a provider profile");
      return false;
    }

    if (form.scheduleKind === "interval" && form.intervalMinutes < 5) {
      toast.showToast("error", "Interval must be at least 5 minutes");
      return false;
    }

    if (form.scheduleKind === "calendar" && form.calendarFrequency === "weekly" && form.daysOfWeek.length === 0) {
      toast.showToast("error", "Choose at least one day for weekly automations");
      return false;
    }

    toast.dismissToast();

    const payload = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      providerProfileId: resolvedProviderProfileId,
      personaId: form.personaId,
      scheduleKind: form.scheduleKind,
      intervalMinutes: form.scheduleKind === "interval" ? form.intervalMinutes : null,
      calendarFrequency: form.scheduleKind === "calendar" ? form.calendarFrequency : null,
      timeOfDay: form.scheduleKind === "calendar" ? form.timeOfDay : null,
      daysOfWeek: form.scheduleKind === "calendar" && form.calendarFrequency === "weekly" ? form.daysOfWeek : [],
      enabled: form.enabled
    };

    try {
      const response = await fetch(
        selectedAutomationId ? `/api/automations/${selectedAutomationId}` : "/api/automations",
        {
          method: selectedAutomationId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const failure = (await response.json().catch(() => ({ error: "Unable to save automation" }))) as {
          error?: string;
        };
        toast.showToast("error", failure.error ?? "Unable to save automation");
        return false;
      }

      const data = (await response.json()) as { automation?: Automation };
      if (!data.automation) {
        throw new Error("Automation response was incomplete");
      }

      const savedAutomation = data.automation;
      const savedForm = automationToForm(savedAutomation);
      setSelectedAutomationId(savedAutomation.id);
      setIsAddingNew(false);
      setForm(savedForm);
      setMobileDetailVisible(true);
      setAutomations((current) => {
        const index = current.findIndex((automation) => automation.id === savedAutomation.id);
        if (index === -1) {
          return [...current, savedAutomation];
        }
        return current.map((automation, currentIndex) =>
          currentIndex === index ? savedAutomation : automation
        );
      });
      await loadData();
      toast.showToast("success", "Automation saved.");
      resetDirty(savedForm);
      return true;
    } catch {
      toast.showToast("error", "Unable to save automation");
      return false;
    }
  }

  async function deleteSelectedAutomation() {
    if (!selectedAutomationId) {
      return;
    }

    const response = await fetch(`/api/automations/${selectedAutomationId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const failure = (await response.json().catch(() => ({ error: "Unable to delete automation" }))) as {
        error?: string;
      };
      toast.showToast("error", failure.error ?? "Unable to delete automation");
      return;
    }

    await loadData();
    resetSelection();
  }

  function handleDeleteConfirm() {
    deleteSelectedAutomation();
    setDeleteConfirmOpen(false);
  }

  async function handleUnsavedSave() {
    if (!(await saveAutomation())) return;
    setUnsavedDialogOpen(false);
    pendingSwitch?.();
    setPendingSwitch(null);
  }

  function handleUnsavedDiscard() {
    setUnsavedDialogOpen(false);
    restoreAutomationDraft();
    if (pendingSwitch) {
      pendingSwitch();
      setPendingSwitch(null);
    }
  }

  const showDetail = isAddingNew || Boolean(selectedAutomationId);


  return (
    <div className="flex min-h-0 w-full flex-1">
      <SettingsSplitPane
        backLabel="Automations"
        detailTitle={isAddingNew ? "New automation" : form.name || "Automation"}
        listHeader={
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Scheduled automations</h2>
              <p className="text-xs text-[var(--muted)]">
                {automations.length} automation{automations.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openNewAutomation}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[var(--muted)] transition-colors duration-200 hover:bg-white/[0.07] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:h-9 md:w-9"
                aria-label="Add automation"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        }
        listPanel={
          isLoading ? (
            <div className="px-3 py-6 text-sm text-[var(--muted)]">Loading automations...</div>
          ) : automations.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
                <Clock3 className="h-4 w-4 text-[var(--muted)]" />
              </div>
              <p className="max-w-[180px] text-xs leading-5 text-[var(--muted)]">
                Create scheduled automations here. Runs will appear in the dedicated Automations workspace.
              </p>
            </div>
          ) : (
            <>
              {automations.map((automation) => (
                <ProfileCard
                  key={automation.id}
                  isActive={automation.id === selectedAutomationId}
                  onClick={() => openAutomation(automation)}
                  title={automation.name}
                  subtitle={describeSchedule(automation)}
                />
              ))}
            </>
          )
        }
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        detailPanel={
          <div className="w-full max-w-[720px]">
            {showDetail ? (
              <div className="space-y-0">
                {/* Header */}
                <DetailHeader
                  title={isAddingNew ? "New automation" : form.name || "Edit automation"}
                  summary="Configure the prompt, execution profile, and cadence for this scheduled automation."
                />

                {/* Details */}
                <div className="py-5">
                  <h4 className={sectionTitle}>Details</h4>
                  <div className="mt-4 space-y-5">
                    <div>
                      <label className={fieldLabel}>Name</label>
                      <Input
                        aria-label="Name"
                        value={form.name}
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Morning summary"
                        className={isFieldDirty("name") ? "!border-amber-500/40" : ""}
                      />
                    </div>

                    <div>
                      <label className={fieldLabel}>Prompt</label>
                      <Textarea
                        aria-label="Prompt"
                        value={form.prompt}
                        onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                        placeholder="Summarize priorities, blockers, and open follow-ups."
                        rows={7}
                        className={isFieldDirty("prompt") ? "!border-amber-500/40" : ""}
                      />
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={fieldLabel}>Provider profile</label>
                        <select
                          aria-label="Provider profile"
                          className={`${selectLike} ${isFieldDirty("providerProfileId") ? "!border-amber-500/40" : ""}`}
                          value={form.providerProfileId}
                          onChange={(event) => setForm((current) => ({ ...current, providerProfileId: event.target.value }))}
                        >
                          <option value="">Select a profile</option>
                          {providerProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className={fieldLabel}>Persona</label>
                        <select
                          aria-label="Persona"
                          className={`${selectLike} ${isFieldDirty("personaId") ? "!border-amber-500/40" : ""}`}
                          value={form.personaId ?? ""}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              personaId: event.target.value || null
                            }))
                          }
                        >
                          <option value="">No persona</option>
                          {personas.map((persona) => (
                            <option key={persona.id} value={persona.id}>
                              {persona.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Schedule */}
                <div className="py-5">
                  <h4 className={sectionTitle}>Schedule</h4>
                  <div className="mt-4 space-y-5">
                    <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
                      <div>
                        <label className={fieldLabel}>Cadence</label>
                        <select
                          aria-label="Schedule type"
                          className={`${selectLike} ${isFieldDirty("scheduleKind") ? "!border-amber-500/40" : ""}`}
                          value={form.scheduleKind}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              scheduleKind: event.target.value as "interval" | "calendar"
                            }))
                          }
                        >
                          <option value="interval">Every X minutes</option>
                          <option value="calendar">Specific local time</option>
                        </select>
                      </div>

                      <label className={`flex items-center gap-3 rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--text)] cursor-pointer ${isFieldDirty("enabled") ? "!border-amber-500/40" : "border-white/6"}`}>
                        <input
                          type="checkbox"
                          checked={form.enabled}
                          onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
                        />
                        Enabled
                      </label>
                    </div>

                    {form.scheduleKind === "interval" ? (
                      <div className="grid gap-5 md:grid-cols-[160px_1fr] md:items-end">
                        <div>
                          <label className={fieldLabel}>Every</label>
                          <Input
                            aria-label="Every"
                            type="number"
                            min={5}
                            step={5}
                            value={String(form.intervalMinutes)}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                intervalMinutes: Number(event.target.value) || 0
                              }))
                            }
                            className={isFieldDirty("intervalMinutes") ? "!border-amber-500/40" : ""}
                          />
                        </div>
                        <p className="pb-3 text-sm text-[var(--muted)]">
                          Minimum interval is 5 minutes.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="grid gap-5 md:grid-cols-2">
                          <div>
                            <label className={fieldLabel}>Frequency</label>
                            <select
                              aria-label="Calendar frequency"
                              className={`${selectLike} ${isFieldDirty("calendarFrequency") ? "!border-amber-500/40" : ""}`}
                              value={form.calendarFrequency}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  calendarFrequency: event.target.value as "daily" | "weekly"
                                }))
                              }
                            >
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                            </select>
                          </div>

                          <div>
                            <label className={fieldLabel}>Time</label>
                            <Input
                              aria-label="Time"
                              type="time"
                              value={form.timeOfDay}
                              onChange={(event) => setForm((current) => ({ ...current, timeOfDay: event.target.value }))}
                              className={isFieldDirty("timeOfDay") ? "!border-amber-500/40" : ""}
                            />
                          </div>
                        </div>

                        {form.calendarFrequency === "weekly" ? (
                          <div>
                            <label className={fieldLabel}>Days</label>
                            <div className="flex flex-wrap gap-2">
                              {WEEKDAYS.map((day) => {
                                const active = form.daysOfWeek.includes(day.value);
                                return (
                                  <button
                                    key={day.value}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => toggleWeekday(day.value)}
                                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                                      active
                                        ? "border-violet-500/30 bg-violet-500/12 text-violet-200"
                                        : "border-white/6 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--text)]"
                                    }`}
                                  >
                                    {day.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <Toast
                  visible={toast.visible}
                  variant={toast.variant}
                  message={toast.message}
                />
                <UnsavedChangesDialog
                  open={unsavedDialogOpen}
                  onOpenChange={setUnsavedDialogOpen}
                  entityType="this automation"
                  onSave={handleUnsavedSave}
                  onDiscard={handleUnsavedDiscard}
                />
                <ConfirmDialog
                  open={deleteConfirmOpen}
                  onOpenChange={setDeleteConfirmOpen}
                  title="Delete automation?"
                  description={
                    <>
                      <strong className="text-[var(--text)] font-medium">{form.name || "This automation"}</strong> will be permanently deleted. This action cannot be undone.
                    </>
                  }
                  onConfirm={handleDeleteConfirm}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
                  <CalendarDays className="h-5 w-5 text-[var(--muted)]" />
                </div>
                <p className="max-w-[260px] text-sm leading-6 text-[var(--muted)]">
                  Select an automation to edit it, or create a new one from the list pane.
                </p>
              </div>
            )}
          </div>
        }
        detailFooter={
          showDetail ? (
            <DetailActionBar
              status={isDirty ? "unsaved" : "saved"}
              leftActions={
                selectedAutomationId ? (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-red-400/80 transition-colors hover:bg-red-500/[0.06] hover:text-red-300 md:min-h-10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : null
              }
              rightActions={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="min-h-11 px-4 text-sm md:min-h-10"
                    onClick={restoreAutomationDraft}
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-11 px-5 text-sm md:min-h-10"
                    onClick={() => void saveAutomation()}
                  >
                    Save
                  </Button>
                </>
              }
            />
          ) : null
        }
      />
    </div>
  );
}
