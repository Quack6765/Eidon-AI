"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, FileText, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    if (editingSkillId) {
      await fetch(`/api/skills/${editingSkillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: skillName,
          description: skillDescription,
          content: skillContent
        })
      });
    } else {
      await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: skillName,
          description: skillDescription,
          content: skillContent
        })
      });
    }

    const res = await fetch("/api/skills");
    const data = (await res.json()) as { skills: Skill[] };
    setSkills(data.skills);
    resetSkillForm();
  }

  async function deleteSkill(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (selectedSkillId === id) {
      setSelectedSkillId(null);
      setMobileDetailVisible(false);
    }
  }

  async function toggleSkill(id: string, enabled: boolean) {
    await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  }

  function handleSelectSkill(skill: Skill) {
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillContent(skill.content);
    setSelectedSkillId(skill.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
  }

  function handleAddNew() {
    setEditingSkillId(null);
    setSkillName("");
    setSkillDescription("");
    setSkillContent("");
    setSelectedSkillId(null);
    setIsAddingNew(true);
    setMobileDetailVisible(true);
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
    setSkillName("");
    setSkillDescription("");
    setSkillContent("");
    setEditingSkillId(null);
    setSelectedSkillId(null);
    setIsAddingNew(false);
    setMobileDetailVisible(false);
  }

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);
  const isBuiltin = selectedSkill?.id.startsWith("builtin-") ?? false;
  const showDetail = selectedSkill || isAddingNew;

  const labelClass = "text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#71717a]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div>
              <h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Skills</h2>
              <p className="text-[0.68rem] text-[#52525b]">
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
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] hover:text-[#f4f4f5] hover:bg-white/[0.06] transition-all duration-200"
                title="Import skill from .md file"
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleAddNew}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] hover:text-[#f4f4f5] hover:bg-white/[0.06] transition-all duration-200"
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
                onClick={() => handleSelectSkill(skill)}
                title={skill.name}
                subtitle={skill.description}
                badges={
                  skill.id.startsWith("builtin-")
                    ? [{ variant: "builtin" as const, label: "BUILT-IN" }]
                    : undefined
                }
                rightSlot={
                  <label className="flex items-center gap-1 text-[0.7rem] text-[#52525b] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={(e) => toggleSkill(skill.id, e.target.checked)}
                      className="rounded"
                    />
                  </label>
                }
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
                      {isAddingNew ? "New Skill" : selectedSkill?.name}
                    </h3>
                    {!isAddingNew && selectedSkill ? (
                      <p className="mt-0.5 text-[0.75rem] text-[#52525b]">
                        {selectedSkill.description}
                      </p>
                    ) : null}
                  </div>

                  {!isAddingNew && !isBuiltin && selectedSkill ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => deleteSkill(selectedSkill.id)}
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
                      value={skillName}
                      onChange={(e) => setSkillName(e.target.value)}
                      placeholder="Skill name"
                      disabled={isBuiltin}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Description</label>
                    <Input
                      value={skillDescription}
                      onChange={(e) => setSkillDescription(e.target.value)}
                      placeholder="Explain when this skill should and should not trigger"
                      disabled={isBuiltin}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>SKILL.md instructions</label>
                    <Textarea
                      value={skillContent}
                      onChange={(e) => setSkillContent(e.target.value)}
                      placeholder="Enter the full skill instructions..."
                      rows={8}
                      readOnly={isBuiltin}
                      className={isBuiltin ? "opacity-60 cursor-default" : ""}
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  {!isBuiltin ? (
                    <Button type="button" onClick={saveSkill}>
                      {editingSkillId ? "Update" : "Add skill"}
                    </Button>
                  ) : null}
                  <Button type="button" variant="secondary" onClick={resetSkillForm}>
                    {isBuiltin ? "Close" : "Cancel"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/6 mb-4">
                  <FileText className="h-5 w-5 text-[#52525b]" />
                </div>
                <p className="text-[0.85rem] text-[#71717a]">
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
