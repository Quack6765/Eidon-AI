"use client";

import { useEffect, useState } from "react";
import { Zap, Plus, Trash2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Skill } from "@/lib/types";

export function SkillsSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);

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
  }

  async function toggleSkill(id: string, enabled: boolean) {
    await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  }

  function editSkill(skill: Skill) {
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillContent(skill.content);
    setShowSkillForm(true);
  }

  function resetSkillForm() {
    setShowSkillForm(false);
    setSkillName("");
    setSkillDescription("");
    setSkillContent("");
    setEditingSkillId(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          Skills
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Skills expose name and description first, then load full instructions when the agent requests them.
        </p>
      </div>

      <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">
              Prompts
            </p>
            <h2
              className="mt-1 text-3xl leading-none text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Skills
            </h2>
          </div>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Skills expose `name` and `description` first, then load the full instructions only when
          the agent explicitly requests them.
        </p>

        <div className="space-y-2">
          {skills.map((skill) => {
            const isBuiltin = skill.id.startsWith("builtin-");
            return (
              <div
                key={skill.id}
                className="flex items-center justify-between rounded-xl border border-white/4 bg-white/[0.01] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text)]">{skill.name}</span>
                    {isBuiltin ? (
                      <span className="inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                        Built-in
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-white/30">{skill.description}</p>
                </div>
                <div className="ml-2 flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-white/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={(e) => toggleSkill(skill.id, e.target.checked)}
                      className="rounded"
                    />
                    On
                  </label>
                  {!isBuiltin ? (
                    <button
                      onClick={() => editSkill(skill)}
                      className="p-1 text-white/30 transition-colors duration-200 hover:text-white"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {!isBuiltin ? (
                    <button
                      onClick={() => deleteSkill(skill.id)}
                      className="p-1 text-red-400/40 transition-colors duration-200 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}

          {showSkillForm ? (
            <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4 animate-fade-in">
              <div>
                <Label>Name</Label>
                <Input
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="Skill name"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={skillDescription}
                  onChange={(e) => setSkillDescription(e.target.value)}
                  placeholder="Explain when this skill should and should not trigger"
                />
              </div>
              <div>
                <Label>SKILL.md instructions</Label>
                <Textarea
                  value={skillContent}
                  onChange={(e) => setSkillContent(e.target.value)}
                  placeholder="Enter the full skill instructions..."
                  rows={6}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={saveSkill}>
                  {editingSkillId ? "Update" : "Add skill"}
                </Button>
                <Button type="button" variant="secondary" onClick={resetSkillForm}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowSkillForm(true)}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add skill
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
