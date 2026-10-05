"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, FileText, Upload, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TextEditModal } from "@/components/ui/text-edit-modal";
import { Toast } from "@/components/ui/toast";
import { fieldLabel, inputLike } from "@/lib/settings-styles";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useToastState } from "@/hooks/use-toast-state";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { Skill } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";
import { DetailActionBar } from "../detail-action-bar";
import { DetailHeader } from "../detail-header";

type SkillDraft = {
  skillName: string;
  skillDescription: string;
  skillContent: string;
  skillEnabledDraft: boolean;
};

function skillToDraft(skill: Skill): SkillDraft {
  return {
    skillName: skill.name,
    skillDescription: skill.description,
    skillContent: skill.content,
    skillEnabledDraft: skill.enabled
  };
}

function emptySkillDraft(): SkillDraft {
  return {
    skillName: "",
    skillDescription: "",
    skillContent: "",
    skillEnabledDraft: true
  };
}

type SkillMaintenanceConfig = {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
  consolidate: boolean;
  archiveTtlDays: number;
  backup: { enabled: boolean; keep: number };
  backgroundReview: { enabled: boolean };
  ledger: boolean;
};

type SkillMaintenancePatch = Omit<Partial<SkillMaintenanceConfig>, "backup" | "backgroundReview"> & {
  backup?: { enabled?: boolean; keep?: number };
  backgroundReview?: { enabled?: boolean };
};

const MAINTENANCE_FIELDS: Array<{
  key: "enabled" | "consolidate" | "staleAfterDays" | "archiveAfterDays" | "archiveTtlDays" | "intervalHours" | "minIdleHours";
  label: string;
  hint: string;
  kind: "toggle" | "days" | "hours";
}> = [
  { key: "enabled", label: "Run skill maintenance", hint: "Keeps the library tidy: unused skills go stale, then archived and recoverable.", kind: "toggle" },
  { key: "staleAfterDays", label: "Mark unused skills stale after", hint: "A skill that has not been loaded for this long is flagged as stale.", kind: "days" },
  { key: "archiveAfterDays", label: "Archive unused skills after", hint: "Archived skills leave the skill list but are never deleted, and can be restored.", kind: "days" },
  { key: "archiveTtlDays", label: "Delete archived skills after", hint: "0 keeps archives forever.", kind: "days" },
  { key: "intervalHours", label: "Run maintenance every", hint: "", kind: "hours" },
  { key: "minIdleHours", label: "Only when idle for", hint: "Maintenance never runs while you are working.", kind: "hours" },
  { key: "consolidate", label: "Merge near-duplicate skills", hint: "Lets maintenance fold narrow sibling skills into one umbrella skill. Off by default.", kind: "toggle" }
];

export function SkillsSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const toast = useToastState();
  const [skillEnabledDraft, setSkillEnabledDraft] = useState(true);
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  const [maintenance, setMaintenance] = useState<SkillMaintenanceConfig | null>(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState("");

  const loadMaintenance = useCallback(async () => {
    try {
      const response = await fetch("/api/skills/maintenance");
      if (!response.ok) {
        setMaintenanceStatus("Unable to load skill maintenance settings");
        return;
      }
      const payload = (await response.json()) as { config?: SkillMaintenanceConfig };
      if (payload.config) {
        setMaintenance(payload.config);
      }
    } catch {
      setMaintenanceStatus("Unable to load skill maintenance settings");
    }
  }, []);

  useEffect(() => {
    void loadMaintenance();
  }, [loadMaintenance]);

  async function patchMaintenance(patch: SkillMaintenancePatch) {
    if (!maintenance) return;
    const next = {
      ...maintenance,
      ...patch,
      backup: { ...maintenance.backup, ...(patch.backup ?? {}) },
      backgroundReview: { ...maintenance.backgroundReview, ...(patch.backgroundReview ?? {}) }
    };
    setMaintenance(next);

    try {
      const response = await fetch("/api/skills/maintenance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      setMaintenanceStatus(response.ok ? "Saved." : "Could not save skill maintenance settings");
    } catch {
      setMaintenanceStatus("Could not save skill maintenance settings");
    }
  }
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState({
    skillName,
    skillDescription,
    skillContent,
    skillEnabledDraft,
  });
  useUnsavedChangesGuard({
    isDirty,
    save: saveSkill,
    discard: restoreSkillDraft,
    entityType: "this skill"
  });

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        if (d.skills) setSkills(d.skills);
      })
      .catch(() => {});
  }, []);

  function restoreSkillDraft() {
    const saved = skills.find((skill) => skill.id === editingSkillId);
    const restored = saved ? skillToDraft(saved) : emptySkillDraft();
    setSkillName(restored.skillName);
    setSkillDescription(restored.skillDescription);
    setSkillContent(restored.skillContent);
    setSkillEnabledDraft(restored.skillEnabledDraft);
    resetDirty(restored);
  }

  async function saveSkill(): Promise<boolean> {
    if (!skillName.trim() || !skillDescription.trim() || !skillContent.trim()) {
      toast.showToast("error", "Name, description, and instructions are required.");
      return false;
    }
    toast.dismissToast();

    let savedId = editingSkillId;
    const isBuiltin = editingSkillId?.startsWith("builtin-") ?? false;
    const payload: {
      name?: string;
      description?: string;
      content?: string;
      enabled: boolean;
    } = {
      enabled: skillEnabledDraft
    };

    if (!isBuiltin) {
      payload.name = skillName;
      payload.description = skillDescription;
      payload.content = skillContent;
    }

    try {
      if (editingSkillId) {
        const updateRes = await fetch(`/api/skills/${editingSkillId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!updateRes.ok) {
          throw new Error("Skill update failed");
        }
      } else {
        const createRes = await fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: skillName,
            description: skillDescription,
            content: skillContent,
            enabled: skillEnabledDraft
          })
        });
        if (!createRes.ok) {
          throw new Error("Skill creation failed");
        }

        const createdData = (await createRes.json()) as { skill?: Skill };
        if (!createdData.skill) {
          throw new Error("Skill creation response was incomplete");
        }
        savedId = createdData.skill.id;
      }

      const res = await fetch("/api/skills");
      if (!res.ok) {
        throw new Error("Skill reload failed");
      }
      const data = (await res.json()) as { skills?: Skill[] };
      if (!Array.isArray(data.skills)) {
        throw new Error("Skill reload response was incomplete");
      }

      const savedSkill = data.skills.find((skill) => skill.id === savedId);
      if (!savedSkill) {
        throw new Error("Saved skill was missing after reload");
      }

      const savedDraft = skillToDraft(savedSkill);
      setSkills(data.skills);
      setSelectedSkillId(savedSkill.id);
      setEditingSkillId(savedSkill.id);
      setSkillName(savedSkill.name);
      setSkillDescription(savedSkill.description);
      setSkillContent(savedSkill.content);
      setSkillEnabledDraft(savedSkill.enabled);
      setIsAddingNew(false);
      setMobileDetailVisible(true);
      resetDirty(savedDraft);
      toast.showToast("success", "Skill saved.");
      return true;
    } catch {
      if (!editingSkillId && savedId) {
        setEditingSkillId(savedId);
        setSelectedSkillId(savedId);
      }
      toast.showToast("error", "Failed to save skill.");
      return false;
    }
  }

  function saveInstructions(value: string) {
    setSkillContent(value);
    setIsInstructionsOpen(false);
  }

  async function deleteSkill(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    setSkills((prev) => prev.filter((s) => s.id !== id));
    toast.dismissToast();
    if (selectedSkillId === id) {
      setSelectedSkillId(null);
      setMobileDetailVisible(false);
    }
  }

  function handleDeleteConfirm() {
    if (pendingDeleteId) {
      deleteSkill(pendingDeleteId);
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }

  function handleSelectSkill(skill: Skill) {
    if (isDirty && selectedSkillId !== skill.id) {
      setPendingSwitch(() => () => selectSkill(skill));
      setUnsavedDialogOpen(true);
      return;
    }
    selectSkill(skill);
  }

  function selectSkill(skill: Skill) {
    const draft = skillToDraft(skill);
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillContent(skill.content);
    setSkillEnabledDraft(skill.enabled);
    toast.dismissToast();
    setSelectedSkillId(skill.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
    resetDirty(draft);
  }

  function handleAddNew() {
    if (isDirty) {
      setPendingSwitch(() => () => addNewSkill());
      setUnsavedDialogOpen(true);
      return;
    }
    addNewSkill();
  }

  function addNewSkill() {
    const draft = emptySkillDraft();
    setEditingSkillId(null);
    setSkillName("");
    setSkillDescription("");
    setSkillContent("");
    setSkillEnabledDraft(true);
    toast.dismissToast();
    setSelectedSkillId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
    resetDirty(draft);
  }

  async function handleUnsavedSave() {
    if (!(await saveSkill())) return;
    setUnsavedDialogOpen(false);
    pendingSwitch?.();
    setPendingSwitch(null);
  }

  function handleUnsavedDiscard() {
    setUnsavedDialogOpen(false);
    restoreSkillDraft();
    if (pendingSwitch) {
      pendingSwitch();
      setPendingSwitch(null);
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const metadata = parseSkillContentMetadata(text);
      const filenameStem = file.name.replace(/\.md$/i, "");

      handleAddNew();
      setSkillName(metadata.name || filenameStem);
      setSkillDescription(metadata.description || "");
      setSkillContent(text);
    };
    reader.readAsText(file);

    e.target.value = "";
  }


  const selectedSkill = skills.find((s) => s.id === selectedSkillId);
  const isBuiltin = selectedSkill?.id.startsWith("builtin-") ?? false;
  const showDetail = selectedSkill || isAddingNew;


  return (
    <div className="flex min-h-0 w-full flex-1">
      <SettingsSplitPane
        backLabel="Skills"
        detailTitle={isAddingNew ? "New skill" : selectedSkill?.name ?? "Skill"}
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Skills</h2>
              <p className="text-xs text-[var(--muted)]">
                {skills.length} skill{skills.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-[var(--muted)] transition-colors duration-200 hover:bg-white/[0.06] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:h-9 md:w-9"
                title="Import skill from .md file"
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleAddNew}
                aria-label="Add skill"
                title="Add skill"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-[var(--muted)] transition-colors duration-200 hover:bg-white/[0.06] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:h-9 md:w-9"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        }
        listPanel={
          <>
            {skills.map((skill) => (
              <ProfileCard
                key={skill.id}
                isActive={skill.id === selectedSkillId}
                isDisabled={!skill.enabled}
                onClick={() => handleSelectSkill(skill)}
                title={skill.name}
                subtitle={skill.description}
                badges={
                  skill.id.startsWith("builtin-")
                    ? [{ variant: "builtin" as const, label: "BUILT-IN" }]
                    : undefined
                }
              />
            ))}
          </>
        }
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        detailPanel={
          <div className="max-w-[720px] space-y-6">
            {showDetail ? (
              <>
                <DetailHeader
                  title={isAddingNew ? "New Skill" : selectedSkill?.name ?? "Skill"}
                  summary={!isAddingNew && selectedSkill ? selectedSkill.description : undefined}
                />

                <div className="space-y-5">
                  {selectedSkill && isBuiltin ? (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                      <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-amber-200">
                        Built-in skill
                      </p>
                      <p className="mt-1 text-sm text-amber-100">
                        This skill is built in and cannot be edited
                      </p>
                    </div>
                  ) : null}

                  <div>
                    <label className={fieldLabel}>Name</label>
                    <Input
                      value={skillName}
                      onChange={(e) => setSkillName(e.target.value)}
                      placeholder="Skill name"
                      disabled={isBuiltin}
                      className={`${inputLike} ${isFieldDirty("skillName") ? "!border-amber-500/40" : ""}`}
                    />
                  </div>
                  <div>
                    <label className={fieldLabel}>Description</label>
                    <Input
                      value={skillDescription}
                      onChange={(e) => setSkillDescription(e.target.value)}
                      placeholder="Explain when this skill should and should not trigger"
                      disabled={isBuiltin}
                      className={`${inputLike} ${isFieldDirty("skillDescription") ? "!border-amber-500/40" : ""}`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={fieldLabel}>Instructions</label>
                      <button
                        type="button"
                        onClick={() => setIsInstructionsOpen(true)}
                        disabled={isBuiltin}
                        className="text-xs text-[var(--accent)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                      >
                        Edit
                      </button>
                    </div>
                    <div
                      onClick={() => { if (!isBuiltin) setIsInstructionsOpen(true); }}
                      className={`rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--muted)] line-clamp-3 transition-colors ${
                        isFieldDirty("skillContent") ? "border-amber-500/40" : "border-white/6"
                      } ${isBuiltin ? "opacity-60 cursor-default" : "cursor-pointer hover:bg-white/[0.06]"}`}
                    >
                      {skillContent || "No instructions set"}
                    </div>
                  </div>
                </div>

                {selectedSkill || isAddingNew ? (
                  <div className="flex gap-2 pt-2">
                    <label className={`flex cursor-pointer items-center gap-2 rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--muted)] transition-colors hover:border-white/15 ${isFieldDirty("skillEnabledDraft") ? "!border-amber-500/40" : "border-white/6"}`}>
                      <input
                        type="checkbox"
                        checked={skillEnabledDraft}
                        onChange={(e) => setSkillEnabledDraft(e.target.checked)}
                        className="rounded"
                      />
                      Enabled
                    </label>
                  </div>
                ) : null}

                <TextEditModal
                  open={isInstructionsOpen}
                  onOpenChange={setIsInstructionsOpen}
                  value={skillContent}
                  onChange={saveInstructions}
                  title="Edit instructions"
                  subtitle="Skill instructions are applied when the skill is activated"
                  placeholder="Enter the full skill instructions..."
                  readOnly={isBuiltin}
                />
                <UnsavedChangesDialog
                  open={unsavedDialogOpen}
                  onOpenChange={setUnsavedDialogOpen}
                  entityType="this skill"
                  onSave={handleUnsavedSave}
                  onDiscard={handleUnsavedDiscard}
                />
                <ConfirmDialog
                  open={deleteConfirmOpen}
                  onOpenChange={setDeleteConfirmOpen}
                  title="Delete skill?"
                  description={
                    <>
                      <strong className="text-[var(--text)] font-medium">{selectedSkill?.name || "This skill"}</strong> will be permanently deleted. This action cannot be undone.
                    </>
                  }
                  onConfirm={handleDeleteConfirm}
                />
                <Toast
                  visible={toast.visible}
                  variant={toast.variant}
                  message={toast.message}
                />
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center pb-6 pt-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/6 mb-4">
                    <FileText className="h-5 w-5 text-[var(--muted)]" />
                  </div>
                  <p className="text-[0.85rem] text-[var(--muted)]">
                    Select a skill or add a new one
                  </p>
                </div>

                <section className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
                  <h3 className="text-sm font-semibold text-[var(--text)]">Skill maintenance</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    How skills are kept from piling up. Skills are only archived, never deleted, and any
                    archived skill can be restored.
                  </p>

                  {maintenance === null ? (
                    <p className="mt-3 text-xs text-[var(--muted)]">Loading…</p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {MAINTENANCE_FIELDS.map((field) => (
                        <div key={field.key} className="space-y-1.5">
                          {field.kind === "toggle" ? (
                            <label className="flex cursor-pointer items-start gap-2.5">
                              <input
                                type="checkbox"
                                checked={Boolean((maintenance as Record<string, unknown>)[field.key])}
                                onChange={(event) => patchMaintenance({ [field.key]: event.target.checked })}
                                className="mt-0.5 h-4 w-4 rounded border-white/15 bg-white/[0.03] accent-[var(--accent)]"
                              />
                              <span className="text-sm text-[var(--text)]">{field.label}</span>
                            </label>
                          ) : (
                            <>
                              <label className={fieldLabel}>{field.label}</label>
                              <input
                                type="number"
                                min={0}
                                value={Number((maintenance as Record<string, unknown>)[field.key])}
                                onChange={(event) =>
                                  patchMaintenance({ [field.key]: Math.max(0, Number(event.target.value) || 0) })
                                }
                                className={`${inputLike} !w-28`}
                              />
                            </>
                          )}
                          {field.hint ? (
                            <p className="text-[11px] leading-4 text-[var(--muted)]">{field.hint}</p>
                          ) : null}
                        </div>
                      ))}

                      <div className="space-y-1.5">
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={maintenance.backgroundReview.enabled}
                            onChange={(event) =>
                              patchMaintenance({ backgroundReview: { enabled: event.target.checked } })
                            }
                            className="mt-0.5 h-4 w-4 rounded border-white/15 bg-white/[0.03] accent-[var(--accent)]"
                          />
                          <span className="text-sm text-[var(--text)]">Learn from each task</span>
                        </label>
                        <p className="text-[11px] leading-4 text-[var(--muted)]">
                          After a task, an agent reviews what it did and saves or improves a skill when the
                          workflow will come up again. One-off work is never saved.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label className={fieldLabel}>Keep this many maintenance backups</label>
                        <input
                          type="number"
                          min={0}
                          value={maintenance.backup.keep}
                          onChange={(event) =>
                            patchMaintenance({ backup: { keep: Math.max(0, Number(event.target.value) || 0) } })
                          }
                          className={`${inputLike} !w-28`}
                        />
                        <p className="text-[11px] leading-4 text-[var(--muted)]">
                          Taken before every maintenance run, so a run can be rolled back.
                        </p>
                      </div>

                      {maintenanceStatus ? (
                        <p className="text-[11px] text-[var(--muted)]">{maintenanceStatus}</p>
                      ) : null}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        }
        detailFooter={
          showDetail ? (
            <DetailActionBar
              status={isDirty ? "unsaved" : "saved"}
              leftActions={
                !isAddingNew && !isBuiltin && selectedSkill ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDeleteId(selectedSkill.id);
                      setDeleteConfirmOpen(true);
                    }}
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
                    onClick={restoreSkillDraft}
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-11 px-5 text-sm md:min-h-10"
                    onClick={saveSkill}
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
