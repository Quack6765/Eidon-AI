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
  }

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);
  const showDetail = selectedPersona || isAddingNew;

  const labelClass = "text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#71717a]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Personas</h2>
              <p className="text-[0.68rem] text-[#52525b]">
                {personas.length} persona{personas.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddNew}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] hover:text-[#f4f4f5] hover:bg-white/[0.06] transition-all duration-200"
            >
              <Plus className="h-4 w-4" />
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
          <div className="max-w-[560px] space-y-6">
            {showDetail ? (
              <>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-[1.1rem] font-semibold text-[#f4f4f5]">
                      {isAddingNew ? "New Persona" : selectedPersona?.name}
                    </h3>
                  </div>

                  {!isAddingNew && selectedPersona ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => deletePersona(selectedPersona.id)}
                      className="gap-1.5 px-3 py-1.5 text-xs"
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-5">
                  <div>
                    <label className={labelClass}>Name</label>
                    <Input
                      value={personaName}
                      onChange={(e) => setPersonaName(e.target.value)}
                      placeholder="Persona name"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>System Instructions (Markdown)</label>
                    <Textarea
                      value={personaContent}
                      onChange={(e) => setPersonaContent(e.target.value)}
                      placeholder="Enter the persona instructions in markdown..."
                      rows={12}
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="button" onClick={savePersona}>
                    {editingPersonaId ? "Update" : "Add persona"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={resetPersonaForm}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/6 mb-4">
                  <FileText className="h-5 w-5 text-[#52525b]" />
                </div>
                <p className="text-[0.85rem] text-[#71717a]">
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