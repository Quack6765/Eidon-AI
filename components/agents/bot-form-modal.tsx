"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fieldLabel } from "@/lib/settings-styles";
import type { BotSummary } from "@/lib/types";

export type BotFormValues = {
  name: string;
  title: string;
  description: string;
  systemPrompt: string;
};

function valuesFromBot(bot?: BotSummary | null, systemPrompt?: string): BotFormValues {
  return {
    name: bot?.name ?? "",
    title: bot?.title ?? "",
    description: bot?.description ?? "",
    systemPrompt: systemPrompt ?? ""
  };
}

export function BotFormModal({
  open,
  onOpenChange,
  bot = null,
  currentSystemPrompt,
  submitLabel,
  title,
  description,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot?: BotSummary | null;
  currentSystemPrompt?: string;
  submitLabel: string;
  title: string;
  description: string;
  onSubmit: (values: BotFormValues) => Promise<string | null>;
}) {
  const [values, setValues] = useState<BotFormValues>(() => valuesFromBot(bot, currentSystemPrompt));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(valuesFromBot(bot, currentSystemPrompt));
      setError(null);
      setIsSubmitting(false);
    }
  }, [open, bot, currentSystemPrompt]);

  function update<K extends keyof BotFormValues>(key: K, value: BotFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    if (!values.name.trim()) {
      setError("Give the bot a name");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const failure = await onSubmit({
        name: values.name.trim(),
        title: values.title.trim(),
        description: values.description.trim(),
        systemPrompt: values.systemPrompt.trim()
      });

      if (failure) {
        setError(failure);
        return;
      }

      onOpenChange(false);
    } catch {
      setError("Unable to save bot");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      icon={
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[var(--accent)]/25 bg-[var(--accent)]/10">
          <Bot className="h-[18px] w-[18px] text-[var(--accent)]" />
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
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="px-4 py-2 text-xs"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !values.name.trim()}
          >
            {isSubmitting ? "Saving…" : submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Name</label>
            <Input
              aria-label="Bot name"
              value={values.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Inbox Bot"
              maxLength={60}
            />
          </div>
          <div>
            <label className={fieldLabel}>Title</label>
            <Input
              aria-label="Bot title"
              value={values.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="Triage specialist"
              maxLength={120}
            />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Description</label>
          <Textarea
            aria-label="Bot description"
            value={values.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="What this bot is responsible for."
            rows={5}
            maxLength={1000}
          />
        </div>
        <div>
          <label className={fieldLabel}>System prompt</label>
          <Textarea
            aria-label="System prompt"
            value={values.systemPrompt}
            onChange={(event) => update("systemPrompt", event.target.value)}
            placeholder="Optional instructions that shape how this bot works."
            rows={10}
            maxLength={8000}
          />
        </div>
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
      </div>
    </DialogShell>
  );
}
