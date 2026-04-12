"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingRow } from "@/components/settings/setting-row";
import type { AppSettings, ConversationRetention } from "@/lib/types";

export function GeneralSection({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [isPending] = useTransition();
  const [conversationRetention, setConversationRetention] = useState<ConversationRetention>(
    settings.conversationRetention
  );
  const [mcpTimeout, setMcpTimeout] = useState(settings.mcpTimeout);
  const [sttEngine, setSttEngine] = useState(settings.sttEngine);
  const [sttLanguage, setSttLanguage] = useState(settings.sttLanguage);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const speechLanguageOptions =
    sttEngine === "browser"
      ? [
          { value: "auto", label: "Auto-detect" },
          { value: "en", label: "English" },
          { value: "fr", label: "French" },
          { value: "es", label: "Spanish" }
        ]
      : [
          { value: "en", label: "English" },
          { value: "fr", label: "French" },
          { value: "es", label: "Spanish" }
        ];

  function handleSpeechEngineChange(nextEngine: AppSettings["sttEngine"]) {
    setSttEngine(nextEngine);
    if (nextEngine === "embedded" && sttLanguage === "auto") {
      setSttLanguage("en");
    }
  }

  async function save() {
    setError("");
    setSuccess("");

    const response = await fetch("/api/settings/general", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationRetention,
        mcpTimeout,
        sttEngine,
        sttLanguage
      })
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Unable to save settings");
      return;
    }
    setSuccess("Settings saved.");
    router.refresh();
  }

  return (
    <div className="w-full max-w-none space-y-6 p-4 sm:p-6 md:max-w-[55%] md:p-8">
      <SettingsCard title="Conversation Retention">
        <SettingRow
          label="Keep conversations for"
          description="Older conversations will be automatically deleted"
        >
          <select
            value={conversationRetention}
            onChange={(e) => setConversationRetention(e.target.value as ConversationRetention)}
            className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30 sm:w-auto"
          >
            <option value="forever">Forever</option>
            <option value="90d">90 days</option>
            <option value="30d">30 days</option>
            <option value="7d">7 days</option>
          </select>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="MCP Server Timeout">
        <SettingRow
          label="Max tool call timeout"
          description="Maximum time (seconds) to wait for an MCP server to respond to a tool call"
        >
          <input
            type="number"
            min={10}
            max={600}
            value={Math.round(mcpTimeout / 1000)}
            onChange={(e) => setMcpTimeout(Number(e.target.value) * 1000)}
            className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30 sm:w-20"
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Speech-to-Text">
        <SettingRow
          label="Speech engine and language"
          description="Choose whether dictation uses the browser speech engine or the embedded model path, then set its default language behavior."
        >
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <select
              aria-label="Speech engine"
              value={sttEngine}
              onChange={(event) =>
                handleSpeechEngineChange(event.target.value as AppSettings["sttEngine"])
              }
              className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30 sm:w-auto"
            >
              <option value="browser">Browser</option>
              <option value="embedded">Embedded model</option>
            </select>

            <select
              aria-label="Speech language"
              value={sttLanguage}
              onChange={(event) =>
                setSttLanguage(event.target.value as AppSettings["sttLanguage"])
              }
              className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30 sm:w-auto"
            >
              {speechLanguageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </SettingRow>
      </SettingsCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button className="w-full sm:w-auto" onClick={() => void save()} disabled={isPending}>
          Save settings
        </Button>
        {success ? <span className="text-sm text-emerald-400">{success}</span> : null}
      </div>

      {error ? (
        <div className="rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}
