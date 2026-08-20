import { Info } from "lucide-react";
import { useRef } from "react";

import { CredentialField } from "@/components/settings/integration-settings/credential-field";
import {
  selectIntegrationProvider,
  type IntegrationDraft
} from "@/components/settings/integration-settings/general-settings-draft";
import { fieldLabel, inputLike, selectLike } from "@/lib/settings-styles";
import type { AppSettings } from "@/lib/types";
import {
  DEFAULT_WEB_SEARCH_PIPELINE,
  WEB_SEARCH_PROVIDER_CATALOG,
  type WebSearchPipelineMode,
  type WebSearchProviderId
} from "@/lib/web-search-catalog";

type Draft = IntegrationDraft<AppSettings["webSearch"]>;

const PIPELINE_MODE_LABELS: Record<WebSearchPipelineMode, string> = {
  auto: "Auto — decompose complex queries",
  always: "Always fan out",
  off: "Off — single search"
};

export function WebSearchSettings({
  draft,
  persisted,
  canManage,
  dirty,
  onChange
}: {
  draft: Draft;
  persisted: Draft;
  canManage: boolean;
  dirty: boolean;
  onChange(draft: Draft): void;
}) {
  const providerDrafts = useRef(new Map<WebSearchProviderId, Draft>());
  providerDrafts.current.set(draft.providerId, draft);

  function selectProvider(providerId: WebSearchProviderId) {
    const cached = providerDrafts.current.get(providerId);
    onChange(cached ?? selectIntegrationProvider<AppSettings["webSearch"]>(
      draft,
      persisted,
      providerId,
      {
        ...(providerId === "searxng" ? { baseUrl: "" } : {}),
        pipeline: draft.configuration.pipeline ?? { ...DEFAULT_WEB_SEARCH_PIPELINE }
      }
    ));
  }

  function updatePipeline(patch: Partial<NonNullable<Draft["configuration"]["pipeline"]>>) {
    onChange({
      ...draft,
      configuration: {
        ...draft.configuration,
        pipeline: { ...(draft.configuration.pipeline ?? DEFAULT_WEB_SEARCH_PIPELINE), ...patch }
      }
    });
  }

  const pipeline = draft.configuration.pipeline ?? DEFAULT_WEB_SEARCH_PIPELINE;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="web-search-provider" className={fieldLabel}>Web search engine</label>
        <p className="mb-2 text-xs text-[var(--muted)]">
          {canManage ? "Choose which web search engine is available to the agent." : "Only admins can change web search settings."}
        </p>
        <select
          id="web-search-provider"
          aria-label="Web search engine"
          value={draft.providerId}
          disabled={!canManage}
          onChange={(event) => selectProvider(event.target.value as WebSearchProviderId)}
          className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
        >
          {Object.entries(WEB_SEARCH_PROVIDER_CATALOG).map(([id, provider]) => (
            <option key={id} value={id}>{provider.label}</option>
          ))}
        </select>
      </div>

      {canManage && draft.providerId === "exa" ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-sky-400/15 bg-sky-400/8 px-4 py-3 text-sm text-sky-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
            <span>Exa API key is optional and the public endpoint works without one.</span>
          </div>
          <CredentialField
            id="web-search-credential"
            label="Exa API key"
            optional
            value={draft.credential}
            action={draft.credentialAction}
            stored={draft.credentialStored}
            dirty={dirty}
            onChange={(credential, credentialAction) => onChange({ ...draft, credential, credentialAction })}
          />
        </div>
      ) : null}

      {canManage && draft.providerId === "tavily" ? (
        <CredentialField
          id="web-search-credential"
          label="Tavily API key"
          value={draft.credential}
          action={draft.credentialAction}
          stored={draft.credentialStored}
          dirty={dirty}
          onChange={(credential, credentialAction) => onChange({ ...draft, credential, credentialAction })}
        />
      ) : null}

      {draft.providerId === "searxng" ? (
        <div>
          <label htmlFor="web-search-base-url" className={fieldLabel}>SearXNG base URL</label>
          <input
            id="web-search-base-url"
            aria-label="SearXNG base URL"
            type="url"
            autoComplete="off"
            value={draft.configuration.baseUrl ?? ""}
            placeholder="https://search.example.com"
            disabled={!canManage}
            onChange={(event) => onChange({
              ...draft,
              configuration: { ...draft.configuration, baseUrl: event.target.value }
            })}
            className={`${inputLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
          />
        </div>
      ) : null}

      {draft.providerId !== "disabled" ? (
        <>
          <div>
            <label htmlFor="web-search-pipeline-mode" className={fieldLabel}>Search pipeline</label>
            <p className="mb-2 text-xs text-[var(--muted)]">
              Complex questions are decomposed into parallel sub-queries whose results are merged.
            </p>
            <select
              id="web-search-pipeline-mode"
              aria-label="Search pipeline mode"
              value={pipeline.mode}
              disabled={!canManage}
              onChange={(event) => updatePipeline({ mode: event.target.value as WebSearchPipelineMode })}
              className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
            >
              {(Object.keys(PIPELINE_MODE_LABELS) as WebSearchPipelineMode[]).map((mode) => (
                <option key={mode} value={mode}>{PIPELINE_MODE_LABELS[mode]}</option>
              ))}
            </select>
          </div>

          {pipeline.mode !== "off" ? (
            <div>
              <label htmlFor="web-search-max-queries" className={fieldLabel}>Max parallel queries</label>
              <p className="mb-2 text-xs text-[var(--muted)]">
                Upper bound on sub-queries fanned out per search.
              </p>
              <select
                id="web-search-max-queries"
                aria-label="Max parallel queries"
                value={pipeline.maxQueries ?? DEFAULT_WEB_SEARCH_PIPELINE.maxQueries}
                disabled={!canManage}
                onChange={(event) => updatePipeline({ maxQueries: Number(event.target.value) })}
                className={`${selectLike} w-full sm:w-[10rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
