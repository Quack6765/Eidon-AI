"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, FileText, Upload, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TextEditModal } from "@/components/ui/text-edit-modal";
import { Toast } from "@/components/ui/toast";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useToastState } from "@/hooks/use-toast-state";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { registerUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";
import type { Skill } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";

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

  useEffect(() => {
    registerUnsavedChangesGuard(
      isDirty
        ? {
            isDirty: () => isDirty,
            save: () => { saveSkill(); },
            discard: () => { resetDirty(); },
            entityType: "this skill",
          }
        : null
    );
    return () => registerUnsavedChangesGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        if (d.skills) setSkills(d.skills);
      })
      .catch(() => {});
  }, []);

  async function saveSkill() {
    if (!skillName.trim() || !skillDescription.trim() || !skillContent.trim()) return;
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

    if (editingSkillId) {
      const updateRes = await fetch(`/api/skills/${editingSkillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!updateRes.ok) {
        toast.showToast("error", "Failed to save skill.");
        return;
      }
    } else {
      const createRes = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: skillName,
          description: skillDescription,
          content: skillContent
        })
      });
      if (!createRes.ok) {
        toast.showToast("error", "Failed to save skill.");
        return;
      }
      const createdData = (await createRes.json().catch(() => null)) as { skill?: Skill } | null;
      savedId = createdData?.skill?.id ?? savedId;
      if (savedId && skillEnabledDraft === false) {
        await fetch(`/api/skills/${savedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false })
        });
      }
    }

    const res = await fetch("/api/skills");
    const data = (await res.json()) as { skills: Skill[] };
    setSkills(data.skills);

    const savedSkill = data.skills.find((skill) => (savedId ? skill.id === savedId : false));
    if (savedSkill) {
      setSelectedSkillId(savedSkill.id);
      setEditingSkillId(savedSkill.id);
      setSkillName(savedSkill.name);
      setSkillDescription(savedSkill.description);
      setSkillContent(savedSkill.content);
      setSkillEnabledDraft(savedSkill.enabled);
    } else if (data.skills.length > 0) {
      const firstMatch = data.skills.find(
        (skill) => skill.name === skillName && skill.content === skillContent
      );
      if (firstMatch) {
        setSelectedSkillId(firstMatch.id);
        setEditingSkillId(firstMatch.id);
        setSkillName(firstMatch.name);
        setSkillDescription(firstMatch.description);
        setSkillContent(firstMatch.content);
        setSkillEnabledDraft(firstMatch.enabled);
      }
    }

    toast.showToast("success", "Skill saved.");
    setIsAddingNew(false);
    setMobileDetailVisible(true);
    resetDirty({ skillName, skillDescription, skillContent, skillEnabledDraft });
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
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillContent(skill.content);
    setSkillEnabledDraft(skill.enabled);
    toast.dismissToast();
    setSelectedSkillId(skill.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
    resetDirty({ skillName: skill.name, skillDescription: skill.description, skillContent: skill.content, skillEnabledDraft: skill.enabled });
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
    setEditingSkillId(null);
    setSkillName("");
    setSkillDescription("");
    setSkillContent("");
    setSkillEnabledDraft(true);
    toast.dismissToast();
    setSelectedSkillId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
    resetDirty({ skillName: "", skillDescription: "", skillContent: "", skillEnabledDraft: true });
  }

  function handleUnsavedSave() {
    setUnsavedDialogOpen(false);
    if (pendingSwitch) {
      saveSkill();
      pendingSwitch();
      setPendingSwitch(null);
    }
  }

  function handleUnsavedDiscard() {
    setUnsavedDialogOpen(false);
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

  function resetSkillForm() {
    const empty = { skillName: "", skillDescription: "", skillContent: "", skillEnabledDraft: true as boolean };
    setSkillName("");
    setSkillDescription("");
    setSkillContent("");
    setSkillEnabledDraft(true);
    setEditingSkillId(null);
    setSelectedSkillId(null);
    setIsAddingNew(false);
    setMobileDetailVisible(false);
    toast.dismissToast();
    resetDirty(empty);
  }

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);
  const isBuiltin = selectedSkill?.id.startsWith("builtin-") ?? false;
  const showDetail = selectedSkill || isAddingNew;

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike = "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
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
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.06] transition-all duration-200"
                title="Import skill from .md file"
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleAddNew}
                aria-label="Add skill"
                title="Add skill"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.06] transition-all duration-200"
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
                <div className="space-y-4">
                  <div>
                    <h3 className={sectionTitle}>
                      {isAddingNew ? "New Skill" : selectedSkill?.name}
                    </h3>
                    {!isAddingNew && selectedSkill ? (
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {selectedSkill.description}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className={sectionDivider} />

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

                {selectedSkill ? (
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

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {isDirty && (
                      <span className="flex items-center gap-1 text-xs text-amber-400/80">
                        <span className="text-[0.5rem]">●</span> Unsaved changes
                      </span>
                    )}
                    <Button type="button" className="px-3 py-1.5 text-xs" onClick={saveSkill}>
                      Save
                    </Button>
                    <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={resetSkillForm}>
                      {isBuiltin ? "Close" : "Cancel"}
                    </Button>
                  </div>
                  {!isAddingNew && !isBuiltin && selectedSkill ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingDeleteId(selectedSkill.id);
                        setDeleteConfirmOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  ) : null}
                </div>
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
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/6 mb-4">
                  <FileText className="h-5 w-5 text-[var(--muted)]" />
                </div>
                <p className="text-[0.85rem] text-[var(--muted)]">
                  Select a skill or add a new one
                </p>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
