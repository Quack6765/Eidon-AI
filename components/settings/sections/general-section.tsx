"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import type { AppSettings, ConversationRetention, ImageGenerationBackend } from "@/lib/types";

type GeneralSectionSettings = AppSettings & {
  hasExaApiKey?: boolean;
  hasTavilyApiKey?: boolean;
  hasGoogleNanoBananaApiKey?: boolean;
  providerProfiles: Array<{ id: string; name: string; model: string; hasApiKey: boolean }>;
};

export function GeneralSection({
  settings,
  canManageImageGeneration = false
}: {
  settings: GeneralSectionSettings;
  canManageImageGeneration?: boolean;
}) {
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
  const toast = useToastState();
  const hasStoredExaApiKey = settings.hasExaApiKey ?? Boolean(settings.exaApiKey);
  const hasStoredTavilyApiKey = settings.hasTavilyApiKey ?? Boolean(settings.tavilyApiKey);

  const [imageGenerationBackend, setImageGenerationBackend] = useState<ImageGenerationBackend>(
    settings.imageGenerationBackend
  );
  const [googleNanoBananaModel, setGoogleNanoBananaModel] = useState(
    settings.googleNanoBananaModel
  );
  const [googleNanoBananaApiKey, setGoogleNanoBananaApiKey] = useState(
    settings.googleNanoBananaApiKey
  );
  const [hasEditedGoogleNanoBananaApiKey, setHasEditedGoogleNanoBananaApiKey] = useState(false);
  const hasStoredGoogleNanoBananaApiKey =
    settings.hasGoogleNanoBananaApiKey ?? Boolean(settings.googleNanoBananaApiKey);

  const [titleGenerationMode, setTitleGenerationMode] = useState<AppSettings["titleGenerationMode"]>(
    settings.titleGenerationMode
  );
  const [titleGenerationProfileId, setTitleGenerationProfileId] = useState<string | null>(
    settings.titleGenerationProfileId
  );

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
    toast.dismissToast();
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
      toast.showToast("error", validationError);
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

    const imagePayload: Record<string, unknown> = {
      imageGenerationBackend,
      googleNanoBananaModel
    };

    if (imageGenerationBackend === "google_nano_banana") {
      if (
        hasEditedGoogleNanoBananaApiKey ||
        (!hasStoredGoogleNanoBananaApiKey && googleNanoBananaApiKey.trim())
      ) {
        imagePayload.googleNanoBananaApiKey = googleNanoBananaApiKey.trim();
      }
    }

    const titleGenerationPayload: Record<string, unknown> = {
      titleGenerationMode,
      titleGenerationProfileId: titleGenerationMode === "specific" ? titleGenerationProfileId : null
    };

    setIsSaving(true);

    try {
      const [generalResponse, imageResponse, titleGenerationResponse] = await Promise.all([
        fetch("/api/settings/general", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }),
        canManageImageGeneration
          ? fetch("/api/settings/image-generation", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(imagePayload)
            })
          : Promise.resolve(null),
        canManageImageGeneration
          ? fetch("/api/settings/title-generation", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(titleGenerationPayload)
            })
          : Promise.resolve(null)
      ]);

      const generalResult = (await generalResponse.json()) as { error?: string };

      if (!generalResponse.ok) {
        toast.showToast("error", generalResult.error ?? "Unable to save settings");
        return;
      }

      if (imageResponse) {
        const imageResult = (await imageResponse.json()) as { error?: string };

        if (!imageResponse.ok) {
          toast.showToast("error", imageResult.error ?? "Unable to save image generation settings");
          return;
        }
      }

      if (titleGenerationResponse) {
        const titleGenerationResult = (await titleGenerationResponse.json()) as { error?: string };

        if (!titleGenerationResponse.ok) {
          toast.showToast("error", titleGenerationResult.error ?? "Unable to save title generation settings");
          return;
        }
      }

      toast.showToast("success", "Settings saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike = "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const selectLike = `${inputLike} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10`;
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

  return (
    <div className="w-full max-w-none space-y-6 p-4 sm:p-6 md:max-w-[55%] md:p-8">
      {/* Conversation Retention */}
      <div className="space-y-4">
        <h3 className={sectionTitle}>Conversation Retention</h3>
        <div className="space-y-1.5">
          <label className={fieldLabel}>Keep conversations for</label>
          <p className="text-xs text-[var(--muted)]">Older conversations will be automatically deleted</p>
          <select
            value={conversationRetention}
            onChange={(event) => setConversationRetention(event.target.value as ConversationRetention)}
            className={`${selectLike} sm:w-auto`}
          >
            <option value="forever">Forever</option>
            <option value="90d">90 days</option>
            <option value="30d">30 days</option>
            <option value="7d">7 days</option>
          </select>
        </div>
      </div>

      <div className={sectionDivider} />

      {/* MCP Server Timeout */}
      <div className="space-y-4">
        <h3 className={sectionTitle}>MCP Server Timeout</h3>
        <div className="space-y-1.5">
          <label className={fieldLabel}>Max tool call timeout</label>
          <p className="text-xs text-[var(--muted)]">Maximum time (seconds) to wait for an MCP server to respond to a tool call</p>
          <input
            type="number"
            min={10}
            max={600}
            value={Math.round(mcpTimeout / 1000)}
            onChange={(event) => setMcpTimeout(Number(event.target.value) * 1000)}
            className={`${inputLike} sm:w-20`}
          />
        </div>
      </div>

      <div className={sectionDivider} />

      {/* Speech-to-Text */}
      <div className="space-y-4">
        <h3 className={sectionTitle}>Speech-to-Text</h3>
        <div className="space-y-1.5">
          <label className={fieldLabel}>Speech engine and language</label>
          <p className="text-xs text-[var(--muted)]">Choose whether dictation uses the browser speech engine or the embedded model path, then set its default language behavior.</p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <select
              aria-label="Speech engine"
              value={sttEngine}
              onChange={(event) =>
                handleSpeechEngineChange(event.target.value as AppSettings["sttEngine"])
              }
              className={`${selectLike} sm:w-auto`}
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
              className={`${selectLike} sm:w-auto`}
            >
              {speechLanguageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className={sectionDivider} />

      {/* Web Search */}
      <div className="space-y-4">
        <h3 className={sectionTitle}>Web Search</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="web-search-engine" className={fieldLabel}>
              Search provider
            </label>
            <p className="text-xs text-[var(--muted)] mb-2">Choose which web search engine is available to the agent.</p>
            <select
              id="web-search-engine"
              aria-label="Web search engine"
              value={webSearchEngine}
              onChange={(event) => {
                resetMessages();
                setWebSearchEngine(event.target.value as AppSettings["webSearchEngine"]);
              }}
              className={`${selectLike} w-full sm:w-[22rem]`}
            >
              <option value="exa">Exa</option>
              <option value="tavily">Tavily</option>
              <option value="searxng">SearXNG</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          {webSearchEngine === "exa" ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5 rounded-xl border border-sky-400/15 bg-sky-400/8 px-4 py-3 text-sm text-sky-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                <span>Exa API key is optional and the public endpoint works without one.</span>
              </div>
              <div>
                <label htmlFor="exa-api-key" className={fieldLabel}>
                  Exa API key
                </label>
                <input
                  id="exa-api-key"
                  aria-label="Exa API key"
                  type="password"
                  autoComplete="off"
                  value={exaApiKey}
                  placeholder={
                    hasStoredExaApiKey && !hasEditedExaApiKey ? "••••••••" : "Optional"
                  }
                  onChange={(event) => {
                    resetMessages();
                    setHasEditedExaApiKey(true);
                    setExaApiKey(event.target.value);
                  }}
                  className={`${inputLike} w-full sm:w-[22rem]`}
                />
              </div>
            </div>
          ) : null}

          {webSearchEngine === "tavily" ? (
            <div>
              <label htmlFor="tavily-api-key" className={fieldLabel}>
                Tavily API key
              </label>
              <input
                id="tavily-api-key"
                aria-label="Tavily API key"
                type="password"
                autoComplete="off"
                value={tavilyApiKey}
                placeholder={
                  hasStoredTavilyApiKey && !hasEditedTavilyApiKey ? "••••••••" : "Required"
                }
                onChange={(event) => {
                  resetMessages();
                  setHasEditedTavilyApiKey(true);
                  setTavilyApiKey(event.target.value);
                }}
                className={`${inputLike} w-full sm:w-[22rem]`}
              />
            </div>
          ) : null}

          {webSearchEngine === "searxng" ? (
            <div>
              <label htmlFor="searxng-base-url" className={fieldLabel}>
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
                className={`${inputLike} w-full sm:w-[22rem]`}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className={sectionDivider} />

      {/* Image Generation */}
      <div className="space-y-4">
        <h3 className={sectionTitle}>Image Generation</h3>
        {!canManageImageGeneration ? (
          <div className="space-y-1.5">
            <label className={fieldLabel}>Image generation backend</label>
            <p className="text-xs text-[var(--muted)]">Only admins can change image generation settings.</p>
            <select
              aria-label="Image generation backend"
              value={imageGenerationBackend}
              disabled
              className={`${selectLike} sm:w-auto opacity-60`}
            >
              <option value="disabled">Disabled</option>
              <option value="google_nano_banana">Google Nano Banana</option>
            </select>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="image-generation-backend" className={fieldLabel}>
                Image generation backend
              </label>
              <p className="text-xs text-[var(--muted)] mb-2">Choose the backend used for image generation.</p>
              <select
                id="image-generation-backend"
                aria-label="Image generation backend"
                value={imageGenerationBackend}
                onChange={(event) => {
                  resetMessages();
                  setImageGenerationBackend(
                    event.target.value as ImageGenerationBackend
                  );
                }}
                className={`${selectLike} w-full sm:w-[22rem]`}
              >
                <option value="disabled">Disabled</option>
                <option value="google_nano_banana">Google Nano Banana</option>
              </select>
            </div>

            {imageGenerationBackend === "google_nano_banana" ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="google-nano-banana-model" className={fieldLabel}>
                    Model
                  </label>
                  <select
                    id="google-nano-banana-model"
                    aria-label="Google Nano Banana model"
                    value={googleNanoBananaModel}
                    onChange={(event) => {
                      resetMessages();
                      setGoogleNanoBananaModel(
                        event.target.value as AppSettings["googleNanoBananaModel"]
                      );
                    }}
                    className={`${selectLike} w-full sm:w-[22rem]`}
                  >
                    <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
                    <option value="gemini-3.1-flash-image-preview">
                      Gemini 3.1 Flash Image Preview
                    </option>
                    <option value="gemini-3-pro-image-preview">
                      Gemini 3 Pro Image Preview
                    </option>
                  </select>
                </div>
                <div>
                  <label htmlFor="google-nano-banana-api-key" className={fieldLabel}>
                    API key
                  </label>
                  <input
                    id="google-nano-banana-api-key"
                    aria-label="Google Nano Banana API key"
                    type="password"
                    autoComplete="off"
                    value={googleNanoBananaApiKey}
                    placeholder={
                      hasStoredGoogleNanoBananaApiKey && !hasEditedGoogleNanoBananaApiKey
                        ? "••••••••"
                        : ""
                    }
                    onChange={(event) => {
                      resetMessages();
                      setHasEditedGoogleNanoBananaApiKey(true);
                      setGoogleNanoBananaApiKey(event.target.value);
                    }}
                    className={`${inputLike} w-full sm:w-[22rem]`}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className={sectionDivider} />

      <div className="space-y-4">
        <h3 className={sectionTitle}>Title Generation</h3>
        {!canManageImageGeneration ? (
          <div className="space-y-1.5">
            <label className={fieldLabel}>Title generation mode</label>
            <p className="text-xs text-[var(--muted)]">Only admins can change title generation settings.</p>
            <select
              aria-label="Title generation mode"
              value={titleGenerationMode}
              disabled
              className={`${selectLike} sm:w-auto opacity-60`}
            >
              <option value="local">Local model</option>
              <option value="same">Same as conversation</option>
              <option value="specific">Specific provider</option>
            </select>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="title-generation-mode" className={fieldLabel}>
                Title generation mode
              </label>
              <p className="text-xs text-[var(--muted)] mb-2">Choose which AI generates conversation titles. Local model runs on the server without an API key.</p>
              <select
                id="title-generation-mode"
                aria-label="Title generation mode"
                value={titleGenerationMode}
                onChange={(event) => {
                  resetMessages();
                  const nextMode = event.target.value as AppSettings["titleGenerationMode"];
                  setTitleGenerationMode(nextMode);
                  if (nextMode === "specific" && !titleGenerationProfileId && settings.providerProfiles.length > 0) {
                    setTitleGenerationProfileId(settings.providerProfiles[0].id);
                  }
                }}
                className={`${selectLike} w-full sm:w-[22rem]`}
              >
                <option value="local">Local model</option>
                <option value="same">Same as conversation</option>
                <option value="specific">Specific provider</option>
              </select>
            </div>

            {titleGenerationMode === "local" && (
              <div className="flex items-start gap-2.5 rounded-xl border border-sky-400/15 bg-sky-400/8 px-4 py-3 text-sm text-sky-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                <span>The SmolLM2-360M-Instruct model (~273 MB) will be downloaded to the server and loaded into memory on save.</span>
              </div>
            )}

            {titleGenerationMode === "specific" && (
              settings.providerProfiles.length > 0 ? (
                <div>
                  <label htmlFor="title-generation-profile" className={fieldLabel}>
                    Provider profile
                  </label>
                  <select
                    id="title-generation-profile"
                    aria-label="Title generation provider profile"
                    value={titleGenerationProfileId ?? settings.providerProfiles[0]?.id ?? ""}
                    onChange={(event) => {
                      resetMessages();
                      setTitleGenerationProfileId(event.target.value || null);
                    }}
                    className={`${selectLike} w-full sm:w-[22rem]`}
                  >
                    {settings.providerProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.model})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">No provider profiles available. Create a provider profile first.</p>
              )
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button className="px-3 py-1.5 text-xs" onClick={() => void save()} disabled={isSaving}>
          Save
        </Button>
      </div>
      <Toast
        visible={toast.visible}
        variant={toast.variant}
        message={toast.message}
      />
    </div>
  );
}
