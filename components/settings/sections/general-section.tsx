"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SettingsCard } from "@/components/settings/settings-card";
import { SettingRow } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import type { AppSettings, ConversationRetention, ImageGenerationBackend } from "@/lib/types";

type GeneralSectionSettings = AppSettings & {
  hasExaApiKey?: boolean;
  hasTavilyApiKey?: boolean;
  hasGoogleNanoBananaApiKey?: boolean;
  hasComfyuiBearerToken?: boolean;
};

const inputClassName =
  "w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30";

const fieldLabelClassName = "mb-1 block text-xs font-medium text-[var(--muted)]";

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
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
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
  const [comfyuiBaseUrl, setComfyuiBaseUrl] = useState(settings.comfyuiBaseUrl);
  const [comfyuiAuthType, setComfyuiAuthType] = useState(settings.comfyuiAuthType);
  const [comfyuiBearerToken, setComfyuiBearerToken] = useState(settings.comfyuiBearerToken);
  const [hasEditedComfyuiBearerToken, setHasEditedComfyuiBearerToken] = useState(false);
  const [comfyuiWorkflowJson, setComfyuiWorkflowJson] = useState(settings.comfyuiWorkflowJson);
  const [comfyuiPromptPath, setComfyuiPromptPath] = useState(settings.comfyuiPromptPath);
  const [comfyuiNegativePromptPath, setComfyuiNegativePromptPath] = useState(
    settings.comfyuiNegativePromptPath
  );
  const [comfyuiWidthPath, setComfyuiWidthPath] = useState(settings.comfyuiWidthPath);
  const [comfyuiHeightPath, setComfyuiHeightPath] = useState(settings.comfyuiHeightPath);
  const [comfyuiSeedPath, setComfyuiSeedPath] = useState(settings.comfyuiSeedPath);
  const [imageError, setImageError] = useState("");
  const [imageSuccess, setImageSuccess] = useState("");
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [isTestingComfyui, setIsTestingComfyui] = useState(false);
  const hasStoredGoogleNanoBananaApiKey =
    settings.hasGoogleNanoBananaApiKey ?? Boolean(settings.googleNanoBananaApiKey);
  const hasStoredComfyuiBearerToken = settings.hasComfyuiBearerToken ?? Boolean(settings.comfyuiBearerToken);

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

  function resetImageMessages() {
    setImageError("");
    setImageSuccess("");
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

  async function saveImageSettings() {
    resetImageMessages();

    const payload: Record<string, unknown> = {
      imageGenerationBackend,
      googleNanoBananaModel
    };

    if (imageGenerationBackend === "google_nano_banana") {
      if (
        hasEditedGoogleNanoBananaApiKey ||
        (!hasStoredGoogleNanoBananaApiKey && googleNanoBananaApiKey.trim())
      ) {
        payload.googleNanoBananaApiKey = googleNanoBananaApiKey.trim();
      }
    }

    if (imageGenerationBackend === "comfyui") {
      payload.comfyuiBaseUrl = comfyuiBaseUrl.trim();
      payload.comfyuiAuthType = comfyuiAuthType;

      if (
        hasEditedComfyuiBearerToken ||
        (!hasStoredComfyuiBearerToken && comfyuiBearerToken.trim())
      ) {
        payload.comfyuiBearerToken = comfyuiBearerToken.trim();
      }

      payload.comfyuiWorkflowJson = comfyuiWorkflowJson;
      payload.comfyuiPromptPath = comfyuiPromptPath;
      payload.comfyuiNegativePromptPath = comfyuiNegativePromptPath;
      payload.comfyuiWidthPath = comfyuiWidthPath;
      payload.comfyuiHeightPath = comfyuiHeightPath;
      payload.comfyuiSeedPath = comfyuiSeedPath;
    }

    setIsSavingImage(true);

    try {
      const response = await fetch("/api/settings/image-generation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setImageError(result.error ?? "Unable to save image generation settings");
        return;
      }

      setImageSuccess("Image generation settings saved.");
      router.refresh();
    } finally {
      setIsSavingImage(false);
    }
  }

  async function testComfyui() {
    resetImageMessages();
    setIsTestingComfyui(true);

    try {
      const response = await fetch("/api/settings/image-generation/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageGenerationBackend: "comfyui" })
      });
      const result = (await response.json()) as { error?: string; imageCount?: number };

      if (!response.ok) {
        setImageError(result.error ?? "ComfyUI test failed");
        return;
      }

      setImageSuccess(`ComfyUI test succeeded. Generated ${result.imageCount} image(s).`);
    } finally {
      setIsTestingComfyui(false);
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
                      hasStoredExaApiKey && !hasEditedExaApiKey ? "••••••••" : "Optional"
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
                      hasStoredTavilyApiKey && !hasEditedTavilyApiKey ? "••••••••" : "Required"
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

      <SettingsCard title="Image Generation">
        {!canManageImageGeneration ? (
          <SettingRow
            label="Image generation backend"
            description="Only admins can change image generation settings."
          >
            <select
              aria-label="Image generation backend"
              value={imageGenerationBackend}
              disabled
              className={`${inputClassName} sm:w-auto opacity-60`}
            >
              <option value="disabled">Disabled</option>
              <option value="google_nano_banana">Google Nano Banana</option>
              <option value="comfyui">ComfyUI</option>
            </select>
          </SettingRow>
        ) : (
          <>
            <SettingRow
              label="Image generation backend"
              description="Choose the backend used for image generation."
            >
              <div className="w-full space-y-3 sm:w-[22rem]">
                <div>
                  <label htmlFor="image-generation-backend" className={fieldLabelClassName}>
                    Image generation backend
                  </label>
                  <select
                    id="image-generation-backend"
                    aria-label="Image generation backend"
                    value={imageGenerationBackend}
                    onChange={(event) => {
                      resetImageMessages();
                      setImageGenerationBackend(
                        event.target.value as ImageGenerationBackend
                      );
                    }}
                    className={inputClassName}
                  >
                    <option value="disabled">Disabled</option>
                    <option value="google_nano_banana">Google Nano Banana</option>
                    <option value="comfyui">ComfyUI</option>
                  </select>
                </div>

                {imageGenerationBackend === "google_nano_banana" ? (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="google-nano-banana-model" className={fieldLabelClassName}>
                        Model
                      </label>
                      <select
                        id="google-nano-banana-model"
                        aria-label="Google Nano Banana model"
                        value={googleNanoBananaModel}
                        onChange={(event) => {
                          resetImageMessages();
                          setGoogleNanoBananaModel(
                            event.target.value as AppSettings["googleNanoBananaModel"]
                          );
                        }}
                        className={inputClassName}
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
                      <label htmlFor="google-nano-banana-api-key" className={fieldLabelClassName}>
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
                          resetImageMessages();
                          setHasEditedGoogleNanoBananaApiKey(true);
                          setGoogleNanoBananaApiKey(event.target.value);
                        }}
                        className={inputClassName}
                      />
                    </div>
                  </div>
                ) : null}

                {imageGenerationBackend === "comfyui" ? (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="comfyui-base-url" className={fieldLabelClassName}>
                        Base URL
                      </label>
                      <input
                        id="comfyui-base-url"
                        aria-label="ComfyUI base URL"
                        type="url"
                        autoComplete="off"
                        value={comfyuiBaseUrl}
                        placeholder="https://comfy.example.com"
                        onChange={(event) => {
                          resetImageMessages();
                          setComfyuiBaseUrl(event.target.value);
                        }}
                        className={inputClassName}
                      />
                    </div>
                    <div>
                      <label htmlFor="comfyui-auth-type" className={fieldLabelClassName}>
                        Auth type
                      </label>
                      <select
                        id="comfyui-auth-type"
                        aria-label="ComfyUI auth type"
                        value={comfyuiAuthType}
                        onChange={(event) => {
                          resetImageMessages();
                          setComfyuiAuthType(
                            event.target.value as AppSettings["comfyuiAuthType"]
                          );
                        }}
                        className={inputClassName}
                      >
                        <option value="none">None</option>
                        <option value="bearer">Bearer token</option>
                      </select>
                    </div>
                    {comfyuiAuthType === "bearer" ? (
                      <div>
                        <label htmlFor="comfyui-bearer-token" className={fieldLabelClassName}>
                          Bearer token
                        </label>
                        <input
                          id="comfyui-bearer-token"
                          aria-label="ComfyUI bearer token"
                          type="password"
                          autoComplete="off"
                          value={comfyuiBearerToken}
                          placeholder={
                            hasStoredComfyuiBearerToken && !hasEditedComfyuiBearerToken
                              ? "••••••••"
                              : ""
                          }
                          onChange={(event) => {
                            resetImageMessages();
                            setHasEditedComfyuiBearerToken(true);
                            setComfyuiBearerToken(event.target.value);
                          }}
                          className={inputClassName}
                        />
                      </div>
                    ) : null}
                    <div>
                      <label htmlFor="comfyui-workflow-json" className={fieldLabelClassName}>
                        Workflow JSON
                      </label>
                      <textarea
                        id="comfyui-workflow-json"
                        aria-label="ComfyUI workflow JSON"
                        rows={4}
                        value={comfyuiWorkflowJson}
                        placeholder='{"3":{"inputs":{"text":"prompt"}}}'
                        onChange={(event) => {
                          resetImageMessages();
                          setComfyuiWorkflowJson(event.target.value);
                        }}
                        className={`${inputClassName} resize-y font-mono`}
                      />
                    </div>
                    <div>
                      <label htmlFor="comfyui-prompt-path" className={fieldLabelClassName}>
                        Prompt path
                      </label>
                      <input
                        id="comfyui-prompt-path"
                        aria-label="ComfyUI prompt path"
                        autoComplete="off"
                        value={comfyuiPromptPath}
                        placeholder="3.inputs.text"
                        onChange={(event) => {
                          resetImageMessages();
                          setComfyuiPromptPath(event.target.value);
                        }}
                        className={inputClassName}
                      />
                    </div>
                    <div>
                      <label htmlFor="comfyui-negative-prompt-path" className={fieldLabelClassName}>
                        Negative prompt path (optional)
                      </label>
                      <input
                        id="comfyui-negative-prompt-path"
                        aria-label="ComfyUI negative prompt path"
                        autoComplete="off"
                        value={comfyuiNegativePromptPath}
                        onChange={(event) => {
                          resetImageMessages();
                          setComfyuiNegativePromptPath(event.target.value);
                        }}
                        className={inputClassName}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="comfyui-width-path" className={fieldLabelClassName}>
                          Width path (optional)
                        </label>
                        <input
                          id="comfyui-width-path"
                          aria-label="ComfyUI width path"
                          autoComplete="off"
                          value={comfyuiWidthPath}
                          onChange={(event) => {
                            resetImageMessages();
                            setComfyuiWidthPath(event.target.value);
                          }}
                          className={inputClassName}
                        />
                      </div>
                      <div>
                        <label htmlFor="comfyui-height-path" className={fieldLabelClassName}>
                          Height path (optional)
                        </label>
                        <input
                          id="comfyui-height-path"
                          aria-label="ComfyUI height path"
                          autoComplete="off"
                          value={comfyuiHeightPath}
                          onChange={(event) => {
                            resetImageMessages();
                            setComfyuiHeightPath(event.target.value);
                          }}
                          className={inputClassName}
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="comfyui-seed-path" className={fieldLabelClassName}>
                        Seed path (optional)
                      </label>
                      <input
                        id="comfyui-seed-path"
                        aria-label="ComfyUI seed path"
                        autoComplete="off"
                        value={comfyuiSeedPath}
                        onChange={(event) => {
                          resetImageMessages();
                          setComfyuiSeedPath(event.target.value);
                        }}
                        className={inputClassName}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      className="w-full sm:w-auto"
                      onClick={() => void testComfyui()}
                      disabled={isTestingComfyui}
                    >
                      {isTestingComfyui ? "Testing..." : "Test ComfyUI workflow"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </SettingRow>

            <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
              <Button
                className="w-full sm:w-auto"
                onClick={() => void saveImageSettings()}
                disabled={isSavingImage}
              >
                Save image settings
              </Button>
              {imageSuccess ? (
                <span className="text-sm text-emerald-400">{imageSuccess}</span>
              ) : null}
            </div>

            {imageError ? (
              <div className="mx-4 mb-4 rounded-xl border border-red-400/10 bg-red-500/8 px-4 py-3 text-sm text-red-300">
                {imageError}
              </div>
            ) : null}
          </>
        )}
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
