"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Clock3, Plus, Trash2 } from "lucide-react";

import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Automation, Persona } from "@/lib/types";

type SettingsPayload = {
  defaultProviderProfileId: string;
  providerProfiles?: Array<{
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

const selectClassName =
  "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

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
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    setIsLoading(true);

    try {
      const [automationsResponse, settingsResponse, personasResponse] = await Promise.all([
        fetch("/api/automations"),
        fetch("/api/settings"),
        fetch("/api/personas")
      ]);

      const automationsPayload = (await automationsResponse.json()) as { automations?: Automation[] };
      const settingsPayload = (await settingsResponse.json()) as { settings?: SettingsPayload };
      const personasPayload = (await personasResponse.json()) as { personas?: Persona[] };

      const nextAutomations = automationsPayload.automations ?? [];
      const nextProfiles = settingsPayload.settings?.providerProfiles ?? [];
      const nextDefaultProviderProfileId =
        settingsPayload.settings?.defaultProviderProfileId || nextProfiles[0]?.id || "";

      setAutomations(nextAutomations);
      setProviderProfiles(nextProfiles);
      setDefaultProviderProfileId(nextDefaultProviderProfileId);
      setPersonas(personasPayload.personas ?? []);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

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
    setSelectedAutomationId(automation.id);
    setIsAddingNew(false);
    setForm(automationToForm(automation));
    setError("");
    setMobileDetailVisible(true);
  }

  function openNewAutomation() {
    setSelectedAutomationId(null);
    setIsAddingNew(true);
    setForm(createDefaultForm(defaultProviderProfileId || providerProfiles[0]?.id || ""));
    setError("");
    setMobileDetailVisible(true);
  }

  function resetSelection() {
    setSelectedAutomationId(null);
    setIsAddingNew(false);
    setError("");
    setMobileDetailVisible(false);
    setForm(createDefaultForm(defaultProviderProfileId || providerProfiles[0]?.id || ""));
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

  async function saveAutomation() {
    const resolvedProviderProfileId = form.providerProfileId || defaultProviderProfileId || providerProfiles[0]?.id || "";

    if (!form.name.trim() || !form.prompt.trim()) {
      setError("Name and prompt are required");
      return;
    }

    if (!resolvedProviderProfileId) {
      setError("Choose a provider profile");
      return;
    }

    if (form.scheduleKind === "interval" && form.intervalMinutes < 5) {
      setError("Interval must be at least 5 minutes");
      return;
    }

    if (form.scheduleKind === "calendar" && form.calendarFrequency === "weekly" && form.daysOfWeek.length === 0) {
      setError("Choose at least one day for weekly automations");
      return;
    }

    setError("");

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
      setError(failure.error ?? "Unable to save automation");
      return;
    }

    const data = (await response.json()) as { automation: Automation };
    await loadData();
    setSelectedAutomationId(data.automation.id);
    setIsAddingNew(false);
    setForm(automationToForm(data.automation));
    setMobileDetailVisible(true);
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
      setError(failure.error ?? "Unable to delete automation");
      return;
    }

    await loadData();
    resetSelection();
  }

  const showDetail = isAddingNew || Boolean(selectedAutomationId);

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        listHeader={
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Scheduled automations</h2>
              <p className="text-[0.68rem] text-[#52525b]">
                {automations.length} automation{automations.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={openNewAutomation}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] transition-all duration-200 hover:bg-white/[0.06] hover:text-[#f4f4f5]"
              aria-label="Add automation"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        }
        listPanel={
          isLoading ? (
            <div className="px-3 py-6 text-sm text-[#71717a]">Loading automations...</div>
          ) : automations.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
                <Clock3 className="h-4 w-4 text-[#52525b]" />
              </div>
              <p className="max-w-[180px] text-xs leading-5 text-[#71717a]">
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
          <div className="max-w-[620px] space-y-6">
            {showDetail ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-[1.1rem] font-semibold text-[#f4f4f5]">
                      {isAddingNew ? "New automation" : form.name || "Edit automation"}
                    </h3>
                    <p className="text-sm text-[#71717a]">
                      Configure the prompt, execution profile, and cadence for this scheduled automation.
                    </p>
                  </div>
                  {selectedAutomationId ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={deleteSelectedAutomation}
                      className="gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-5">
                  <div>
                    <Label>Name</Label>
                    <Input
                      aria-label="Name"
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Morning summary"
                    />
                  </div>

                  <div>
                    <Label>Prompt</Label>
                    <Textarea
                      aria-label="Prompt"
                      value={form.prompt}
                      onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                      placeholder="Summarize priorities, blockers, and open follow-ups."
                      rows={7}
                    />
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <Label>Provider profile</Label>
                      <select
                        aria-label="Provider profile"
                        className={selectClassName}
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
                      <Label>Persona</Label>
                      <select
                        aria-label="Persona"
                        className={selectClassName}
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

                  <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
                    <div>
                      <Label>Cadence</Label>
                      <select
                        aria-label="Schedule type"
                        className={selectClassName}
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

                    <label className="flex items-center gap-2 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-3 text-sm text-[#d4d4d8]">
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
                        <Label>Every</Label>
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
                        />
                      </div>
                      <p className="pb-3 text-sm text-[#71717a]">
                        Minimum interval is 5 minutes.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="grid gap-5 md:grid-cols-2">
                        <div>
                          <Label>Frequency</Label>
                          <select
                            aria-label="Calendar frequency"
                            className={selectClassName}
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
                          <Label>Time</Label>
                          <Input
                            aria-label="Time"
                            type="time"
                            value={form.timeOfDay}
                            onChange={(event) => setForm((current) => ({ ...current, timeOfDay: event.target.value }))}
                          />
                        </div>
                      </div>

                      {form.calendarFrequency === "weekly" ? (
                        <div>
                          <Label>Days</Label>
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
                                      : "border-white/6 bg-white/[0.03] text-[#a1a1aa] hover:bg-white/[0.06] hover:text-[#f4f4f5]"
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

                  {error ? (
                    <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
                      {error}
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="button" onClick={() => void saveAutomation()}>
                    Save automation
                  </Button>
                  <Button type="button" variant="secondary" onClick={resetSelection}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
                  <CalendarDays className="h-5 w-5 text-[#52525b]" />
                </div>
                <p className="max-w-[260px] text-sm leading-6 text-[#71717a]">
                  Select an automation to edit it, or create a new one from the list pane.
                </p>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
