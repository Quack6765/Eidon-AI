"use client";

import { useEffect, useState } from "react";
import { Plus, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const [personaContentDraft, setPersonaContentDraft] = useState("");

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((d) => {
        if (d.personas) setPersonas(d.personas);
      })
      .catch(() => {});
  }, []);

  async function savePersona() {
    if (!personaName.trim() || !personaContent.trim()) return;

    if (editingPersonaId) {
      await fetch(`/api/personas/${editingPersonaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: personaName,
          content: personaContent
        })
      });
    } else {
      await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: personaName,
          content: personaContent
        })
      });
    }

    const res = await fetch("/api/personas");
    const data = (await res.json()) as { personas: Persona[] };
    setPersonas(data.personas);
    resetPersonaForm();
  }

  async function deletePersona(id: string) {
    await fetch(`/api/personas/${id}`, { method: "DELETE" });
    setPersonas((prev) => prev.filter((p) => p.id !== id));
    if (selectedPersonaId === id) {
      setSelectedPersonaId(null);
      setMobileDetailVisible(false);
    }
  }

  function handleSelectPersona(persona: Persona) {
    setEditingPersonaId(persona.id);
    setPersonaName(persona.name);
    setPersonaContent(persona.content);
    setSelectedPersonaId(persona.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
  }

  function handleAddNew() {
    setEditingPersonaId(null);
    setPersonaName("");
    setPersonaContent("");
    setSelectedPersonaId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
  }

  function resetPersonaForm() {
    setPersonaName("");
    setPersonaContent("");
    setEditingPersonaId(null);
    setSelectedPersonaId(null);
    setIsAddingNew(false);
    setMobileDetailVisible(false);
    setIsPersonaContentOpen(false);
    setPersonaContentDraft("");
  }

  function openPersonaContent() {
    setPersonaContentDraft(personaContent);
    setIsPersonaContentOpen(true);
  }

  function savePersonaContent() {
    setPersonaContent(personaContentDraft);
    setIsPersonaContentOpen(false);
  }

  function closePersonaContent() {
    setIsPersonaContentOpen(false);
    setPersonaContentDraft("");
  }

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);
  const showDetail = selectedPersona || isAddingNew;

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike = "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const selectLike = `${inputLike} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10`;
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

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
                    {!isAddingNew && selectedPersona ? (
                      <button
                        type="button"
                        onClick={() => deletePersona(selectedPersona.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300"
                      >
                        Delete
                      </button>
                    ) : null}
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
                        className="cursor-pointer rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--muted)] line-clamp-3 hover:bg-white/[0.06] transition-colors"
                      >
                        {personaContent || "No system instructions set"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className={`${sectionDivider} py-5`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" className="px-3 py-1.5 text-xs" onClick={savePersona}>
                      Save
                    </Button>
                    <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={resetPersonaForm}>
                      Cancel
                    </Button>
                  </div>
                </div>

                {/* Persona Content Modal */}
                {isPersonaContentOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                      className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                      onClick={closePersonaContent}
                    />
                    <div className="relative w-full max-w-[720px] max-h-[80vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-[var(--text)]">Edit system instructions</h3>
                        <button
                          type="button"
                          onClick={closePersonaContent}
                          className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                      </div>
                      <p className="mb-3 text-xs text-[var(--muted)]">
                        Markdown is supported
                      </p>
                      <Textarea
                        autoComplete="off"
                        spellCheck={false}
                        value={personaContentDraft}
                        onChange={(event) => setPersonaContentDraft(event.target.value)}
                        rows={16}
                        className="flex-1 resize-none min-h-[300px]"
                      />
                      <div className="flex flex-wrap items-center justify-end gap-2 mt-5 pt-4 border-t border-white/[0.06]">
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-3 py-1.5 text-xs"
                          onClick={closePersonaContent}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          className="px-3 py-1.5 text-xs"
                          onClick={savePersonaContent}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
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
    </div>
  );
}
