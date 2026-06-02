"use client";

import { useEffect, useState } from "react";
import { Plus, FileText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TextEditModal } from "@/components/ui/text-edit-modal";
import { Toast } from "@/components/ui/toast";
import { fieldLabel, sectionTitle, sectionDivider } from "@/lib/settings-styles";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useToastState } from "@/hooks/use-toast-state";
import { registerUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";
import type { Persona } from "@/lib/types";

import { SettingsSplitPane } from "../settings-split-pane";
import { ProfileCard } from "../profile-card";

export function PersonasSection() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaName, setPersonaName] = useState("");
  const [personaContent, setPersonaContent] = useState("");
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [isPersonaContentOpen, setIsPersonaContentOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const toast = useToastState();
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState({
    personaName,
    personaContent,
  });

  useEffect(() => {
    registerUnsavedChangesGuard(
      isDirty
        ? {
            isDirty: () => isDirty,
            save: () => { savePersona(); },
            discard: () => { resetDirty(); },
            entityType: "this persona",
          }
        : null
    );
    return () => registerUnsavedChangesGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((d) => {
        if (d.personas) setPersonas(d.personas);
      })
      .catch(() => {});
  }, []);

  async function savePersona() {
    if (!personaName.trim() || !personaContent.trim()) {
      toast.showToast("error", "Name and system instructions are required.");
      return;
    }

    try {
      if (editingPersonaId) {
        const res = await fetch(`/api/personas/${editingPersonaId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: personaName,
            content: personaContent
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast.showToast("error", (data as { error?: string })?.error ?? "Failed to save persona");
          return;
        }
      } else {
        const res = await fetch("/api/personas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: personaName,
            content: personaContent
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast.showToast("error", (data as { error?: string })?.error ?? "Failed to create persona");
          return;
        }
      }

      const res = await fetch("/api/personas");
      const data = (await res.json()) as { personas: Persona[] };
      setPersonas(data.personas);
      resetPersonaForm();
      toast.showToast("success", "Persona saved.");
    } catch {
      toast.showToast("error", "Failed to save persona.");
    }
  }

  async function deletePersona(id: string) {
    try {
      const res = await fetch(`/api/personas/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.showToast("error", "Failed to delete persona.");
        return;
      }
      setPersonas((prev) => prev.filter((p) => p.id !== id));
      if (selectedPersonaId === id) {
        setSelectedPersonaId(null);
        setMobileDetailVisible(false);
      }
      toast.showToast("success", "Persona deleted.");
    } catch {
      toast.showToast("error", "Failed to delete persona.");
    }
  }

  function handleDeleteConfirm() {
    if (pendingDeleteId) {
      deletePersona(pendingDeleteId);
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }

  function handleSelectPersona(persona: Persona) {
    if (isDirty && selectedPersonaId !== persona.id) {
      setPendingSwitch(() => () => selectPersona(persona));
      setUnsavedDialogOpen(true);
      return;
    }
    selectPersona(persona);
  }

  function selectPersona(persona: Persona) {
    setEditingPersonaId(persona.id);
    setPersonaName(persona.name);
    setPersonaContent(persona.content);
    setSelectedPersonaId(persona.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
    resetDirty({ personaName: persona.name, personaContent: persona.content });
  }

  function handleAddNew() {
    if (isDirty) {
      setPendingSwitch(() => () => addNewPersona());
      setUnsavedDialogOpen(true);
      return;
    }
    addNewPersona();
  }

  function addNewPersona() {
    setEditingPersonaId(null);
    setPersonaName("");
    setPersonaContent("");
    setSelectedPersonaId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
    resetDirty({ personaName: "", personaContent: "" });
  }

  function handleUnsavedSave() {
    setUnsavedDialogOpen(false);
    if (pendingSwitch) {
      savePersona();
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

  function resetPersonaForm() {
    const empty = { personaName: "", personaContent: "" };
    setPersonaName("");
    setPersonaContent("");
    setEditingPersonaId(null);
    setSelectedPersonaId(null);
    setIsAddingNew(false);
    setMobileDetailVisible(false);
    resetDirty(empty);
  }

  function openPersonaContent() {
    setIsPersonaContentOpen(true);
  }

  function savePersonaContent(value: string) {
    setPersonaContent(value);
    setIsPersonaContentOpen(false);
  }

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);
  const showDetail = selectedPersona || isAddingNew;


  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Personas</h2>
              <p className="text-xs text-[var(--muted)]">
                {personas.length} persona{personas.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddNew}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.07] transition-all duration-200"
              aria-label="Add persona"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        }
        listPanel={
          <>
            {personas.map((persona) => (
              <ProfileCard
                key={persona.id}
                isActive={persona.id === selectedPersonaId}
                onClick={() => handleSelectPersona(persona)}
                title={persona.name}
              />
            ))}
          </>
        }
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        detailPanel={
          <div className="w-full max-w-[720px]">
            {showDetail ? (
              <div className="space-y-0">
                {/* Header */}
                <div className="pb-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--text)]">
                        {isAddingNew ? "New persona" : selectedPersona?.name}
                      </h3>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {isAddingNew
                          ? "Create a new persona with custom system instructions."
                          : "Edit the name and system instructions for this persona."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Identity */}
                <div className={`${sectionDivider} py-5`}>
                  <h4 className={sectionTitle}>Identity</h4>
                  <div className="mt-4 space-y-5">
                    <div>
                      <label className={fieldLabel}>Name</label>
                      <Input
                        value={personaName}
                        onChange={(e) => setPersonaName(e.target.value)}
                        placeholder="Persona name"
                        className={isFieldDirty("personaName") ? "border-amber-500/40" : ""}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className={fieldLabel}>System Instructions (Markdown)</label>
                        <button
                          type="button"
                          onClick={openPersonaContent}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                      <div
                        onClick={openPersonaContent}
                        className={`cursor-pointer rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--muted)] line-clamp-3 hover:bg-white/[0.06] transition-colors ${isFieldDirty("personaContent") ? "border-amber-500/40" : "border-white/6"}`}
                      >
                        {personaContent || "No system instructions set"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className={`${sectionDivider} py-5`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {isDirty && (
                        <span className="flex items-center gap-1 text-xs text-amber-400/80">
                          <span className="text-[0.5rem]">●</span> Unsaved changes
                        </span>
                      )}
                      <Button type="button" className="px-3 py-1.5 text-xs" onClick={savePersona}>
                        Save
                      </Button>
                      <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={resetPersonaForm}>
                        Cancel
                      </Button>
                    </div>
                    {!isAddingNew && selectedPersona ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDeleteId(selectedPersona.id);
                          setDeleteConfirmOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>

                <TextEditModal
                  open={isPersonaContentOpen}
                  onOpenChange={setIsPersonaContentOpen}
                  value={personaContent}
                  onChange={savePersonaContent}
                  title="Edit system instructions"
                  subtitle="Markdown is supported"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/6 mb-4">
                  <FileText className="h-5 w-5 text-[var(--muted)]" />
                </div>
                <p className="text-sm text-[var(--muted)]">
                  Select a persona or add a new one
                </p>
              </div>
            )}
          </div>
        }
      />
      <Toast
        visible={toast.visible}
        variant={toast.variant}
        message={toast.message}
      />
      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        onOpenChange={setUnsavedDialogOpen}
        entityType="this persona"
        onSave={handleUnsavedSave}
        onDiscard={handleUnsavedDiscard}
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete persona?"
        description={
          <>
            <strong className="text-[var(--text)] font-medium">{selectedPersona?.name ?? "This persona"}</strong> will be permanently deleted. This action cannot be undone.
          </>
        }
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
