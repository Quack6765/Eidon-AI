"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fieldLabel } from "@/lib/settings-styles";
import { parseSkillContentMetadata, stripSkillFrontmatter } from "@/lib/skill-metadata";
import type { Skill } from "@/lib/types";

type SkillFormValues = {
  name: string;
  description: string;
  instructions: string;
};

function valuesFromSkill(skill: Skill | null): SkillFormValues {
  if (!skill) {
    return {
      name: "",
      description: "",
      instructions: ""
    };
  }

  const metadata = parseSkillContentMetadata(skill.content);
  return {
    name: metadata.name ?? skill.name,
    description: metadata.description ?? skill.description,
    instructions: stripSkillFrontmatter(skill.content).trim()
  };
}

export function BotSkillModal({
  open,
  onOpenChange,
  botId,
  skill = null,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  skill?: Skill | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<SkillFormValues>(() => valuesFromSkill(skill));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(valuesFromSkill(skill));
      setError(null);
      setIsSaving(false);
    }
  }, [open, skill]);

  function update<K extends keyof SkillFormValues>(key: K, value: SkillFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    const name = values.name.trim();
    const description = values.description.trim();
    const instructions = values.instructions.trim();

    if (!name || !description || !instructions) {
      setError("Name, description, and instructions are all required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        skill ? `/api/bots/${botId}/skills/${skill.id}` : `/api/bots/${botId}/skills`,
        {
          method: skill ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, instructions })
        }
      );

      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(failure?.error ?? "Unable to save skill");
        return;
      }

      onOpenChange(false);
      onSaved();
    } catch {
      setError("Unable to save skill");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={skill ? "Edit skill" : "Add skill"}
      description="Skills live in this bot's workspace as SKILL.md files."
      size="lg"
      icon={
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[var(--accent)]/25 bg-[var(--accent)]/10">
          <Sparkles className="h-[18px] w-[18px] text-[var(--accent)]" />
        </div>
      }
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            autoFocus
            className="px-4 py-2 text-xs"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="px-4 py-2 text-xs"
            onClick={() => void handleSubmit()}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Name</label>
            <Input
              aria-label="Skill name"
              value={values.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Web research"
              maxLength={100}
            />
          </div>
          <div>
            <label className={fieldLabel}>Description</label>
            <Input
              aria-label="Skill description"
              value={values.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="What this skill does"
              maxLength={200}
            />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Instructions</label>
          <Textarea
            aria-label="Skill instructions"
            value={values.instructions}
            onChange={(event) => update("instructions", event.target.value)}
            placeholder="Step-by-step instructions for the bot to follow when using this skill."
            rows={12}
          />
        </div>
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
      </div>
    </DialogShell>
  );
}
