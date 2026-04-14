"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, FileText, Upload } from "lucide-react";

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
  const [skillSuccess, setSkillSuccess] = useState("");
  const [skillEnabledDraft, setSkillEnabledDraft] = useState(true);
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
    setSkillSuccess("");

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
      await fetch(`/api/skills/${editingSkillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
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

    setSkillSuccess("Skill saved.");
    setIsAddingNew(false);
    setMobileDetailVisible(true);
  }

  async function deleteSkill(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    setSkills((prev) => prev.filter((s) => s.id !== id));
    setSkillSuccess("");
    if (selectedSkillId === id) {
      setSelectedSkillId(null);
      setMobileDetailVisible(false);
    }
  }

  function handleSelectSkill(skill: Skill) {
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillContent(skill.content);
    setSkillEnabledDraft(skill.enabled);
    setSkillSuccess("");
    setSelectedSkillId(skill.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
  }

  function handleAddNew() {
    setEditingSkillId(null);
    setSkillName("");
    setSkillDescription("");
    setSkillContent("");
    setSkillEnabledDraft(true);
    setSkillSuccess("");
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
    setSkillEnabledDraft(true);
    setEditingSkillId(null);
    setSelectedSkillId(null);
    setIsAddingNew(false);
    setMobileDetailVisible(false);
    setSkillSuccess("");
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
                aria-label="Add skill"
                title="Add skill"
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
                    <label className={labelClass}>INSTRUCTIONS</label>
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

                {selectedSkill ? (
                  <div className="flex gap-2 pt-2">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/8 bg-white/[0.04] px-2.5 py-1.5 text-xs text-[#52525b] transition-colors hover:border-white/15">
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

                <div className="flex gap-2 pt-2">
                  <Button type="button" onClick={saveSkill}>
                    {editingSkillId ? "Update" : "Add skill"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={resetSkillForm}>
                    {isBuiltin ? "Close" : "Cancel"}
                  </Button>
                  {skillSuccess ? (
                    <div className="flex items-center gap-1.5 text-sm text-emerald-400">
                      <Check className="h-3.5 w-3.5" />
                      {skillSuccess}
                    </div>
                  ) : null}
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
