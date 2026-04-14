"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SettingsCard } from "@/components/settings/settings-card";
import { SettingRow } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import type { AppSettings, ConversationRetention } from "@/lib/types";

type GeneralSectionSettings = AppSettings & {
  hasExaApiKey?: boolean;
  hasTavilyApiKey?: boolean;
};

const inputClassName =
  "w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30";

const fieldLabelClassName = "mb-1 block text-xs font-medium text-[var(--muted)]";

export function GeneralSection({ settings }: { settings: GeneralSectionSettings }) {
  const router = useRouter();
  const [conversationRetention, setConversationRetention] = useState<ConversationRetention>(
    settings.conversationRetention
  );
  const [mcpTimeout, setMcpTimeout] = useState(settings.mcpTimeout);
  const [sttEngine, setSttEngine] = useState(settings.sttEngine);
  const [sttLanguage, setSttLanguage] = useState(settings.sttLanguage);
  const [webSearchEngine, setWebSearchEngine] = useState(settings.webSearchEngine);
  const [exaApiKey, setExaApiKey] = useState(settings.exaApiKey);
  const [tavilyApiKey, setTavilyApiKey] = useState(settings.tavilyApiKey);
  const [searxngBaseUrl, setSearxngBaseUrl] = useState(settings.searxngBaseUrl);
  const [hasEditedExaApiKey, setHasEditedExaApiKey] = useState(false);
  const [hasEditedTavilyApiKey, setHasEditedTavilyApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const hasStoredExaApiKey = settings.hasExaApiKey ?? Boolean(settings.exaApiKey);
  const hasStoredTavilyApiKey = settings.hasTavilyApiKey ?? Boolean(settings.tavilyApiKey);

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

  function resetMessages() {
    setError("");
    setSuccess("");
  }

  function handleSpeechEngineChange(nextEngine: AppSettings["sttEngine"]) {
    resetMessages();
    setSttEngine(nextEngine);
    if (nextEngine === "embedded" && sttLanguage === "auto") {
      setSttLanguage("en");
    }
  }

  function getSearchValidationError() {
    if (
      webSearchEngine === "tavily" &&
      !tavilyApiKey.trim() &&
      (hasEditedTavilyApiKey || !hasStoredTavilyApiKey)
    ) {
      return "Tavily API key is required.";
    }

    if (webSearchEngine === "searxng" && !searxngBaseUrl.trim()) {
      return "SearXNG base URL is required.";
    }

    if (webSearchEngine === "searxng") {
      try {
        new URL(searxngBaseUrl.trim());
      } catch {
        return "SearXNG base URL must be valid.";
      }
    }

    return "";
  }

  async function save() {
    resetMessages();

    const validationError = getSearchValidationError();
    if (validationError) {
      setError(validationError);
      return;
    }

    const trimmedExaApiKey = exaApiKey.trim();
    const trimmedTavilyApiKey = tavilyApiKey.trim();
    const payload: Record<string, unknown> = {
      conversationRetention,
      mcpTimeout,
      sttEngine,
      sttLanguage,
      webSearchEngine,
      searxngBaseUrl: searxngBaseUrl.trim()
    };

    if (hasEditedExaApiKey || !hasStoredExaApiKey) {
      payload.exaApiKey = trimmedExaApiKey;
    }

    if (hasEditedExaApiKey && !trimmedExaApiKey && hasStoredExaApiKey) {
      payload.clearExaApiKey = true;
    }

    if (hasEditedTavilyApiKey || !hasStoredTavilyApiKey) {
      payload.tavilyApiKey = trimmedTavilyApiKey;
    }

    if (hasEditedTavilyApiKey && !trimmedTavilyApiKey && hasStoredTavilyApiKey) {
      payload.clearTavilyApiKey = true;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? "Unable to save settings");
        return;
      }

      setSuccess("Settings saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
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
            onChange={(event) => setConversationRetention(event.target.value as ConversationRetention)}
            className={`${inputClassName} sm:w-auto`}
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
            onChange={(event) => setMcpTimeout(Number(event.target.value) * 1000)}
            className={`${inputClassName} sm:w-20`}
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
              className={`${inputClassName} sm:w-auto`}
            >
              <option value="browser">Browser</option>
              <option value="embedded">Embedded model</option>
            </select>

            <select
              aria-label="Speech language"
              value={sttLanguage}
              onChange={(event) => {
                resetMessages();
                setSttLanguage(event.target.value as AppSettings["sttLanguage"]);
              }}
              className={`${inputClassName} sm:w-auto`}
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

      <SettingsCard title="Web Search">
        <SettingRow
          label="Search provider"
          description="Choose which web search engine is available to the agent."
        >
          <div className="w-full space-y-3 sm:w-[22rem]">
            <div>
              <label htmlFor="web-search-engine" className={fieldLabelClassName}>
                Web search engine
              </label>
              <select
                id="web-search-engine"
                aria-label="Web search engine"
                value={webSearchEngine}
                onChange={(event) => {
                  resetMessages();
                  setWebSearchEngine(event.target.value as AppSettings["webSearchEngine"]);
                }}
                className={inputClassName}
              >
                <option value="exa">Exa</option>
                <option value="tavily">Tavily</option>
                <option value="searxng">SearXNG</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {webSearchEngine === "exa" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-[var(--muted)]">
                  Exa API key is optional and the public endpoint works without one.
                </div>
                <div>
                  <label htmlFor="exa-api-key" className={fieldLabelClassName}>
                    Exa API key
                  </label>
                  <input
                    id="exa-api-key"
                    aria-label="Exa API key"
                    type="password"
                    autoComplete="off"
                    value={exaApiKey}
                    placeholder={
                      hasStoredExaApiKey && !hasEditedExaApiKey ? "Stored API key" : "Optional"
                    }
                    onChange={(event) => {
                      resetMessages();
                      setHasEditedExaApiKey(true);
                      setExaApiKey(event.target.value);
                    }}
                    className={inputClassName}
                  />
                </div>
              </div>
            ) : null}

            {webSearchEngine === "tavily" ? (
              <div>
                <label htmlFor="tavily-api-key" className={fieldLabelClassName}>
                  Tavily API key
                </label>
                <input
                  id="tavily-api-key"
                  aria-label="Tavily API key"
                  type="password"
                  autoComplete="off"
                  value={tavilyApiKey}
                  placeholder={
                    hasStoredTavilyApiKey && !hasEditedTavilyApiKey ? "Stored API key" : "Required"
                  }
                  onChange={(event) => {
                    resetMessages();
                    setHasEditedTavilyApiKey(true);
                    setTavilyApiKey(event.target.value);
                  }}
                  className={inputClassName}
                />
              </div>
            ) : null}

            {webSearchEngine === "searxng" ? (
              <div>
                <label htmlFor="searxng-base-url" className={fieldLabelClassName}>
                  SearXNG base URL
                </label>
                <input
                  id="searxng-base-url"
                  aria-label="SearXNG base URL"
                  type="url"
                  autoComplete="off"
                  value={searxngBaseUrl}
                  placeholder="https://search.example.com"
                  onChange={(event) => {
                    resetMessages();
                    setSearxngBaseUrl(event.target.value);
                  }}
                  className={inputClassName}
                />
              </div>
            ) : null}
          </div>
        </SettingRow>
      </SettingsCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button className="w-full sm:w-auto" onClick={() => void save()} disabled={isSaving}>
          Save settings
        </Button>
        {success ? <span className="text-sm text-emerald-400">{success}</span> : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/10 bg-red-500/8 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}
