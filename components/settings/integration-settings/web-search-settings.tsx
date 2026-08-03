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
  WEB_SEARCH_PROVIDER_CATALOG,
  type WebSearchProviderId
} from "@/lib/web-search-catalog";

type Draft = IntegrationDraft<AppSettings["webSearch"]>;

export function WebSearchSettings({
  draft,
  persisted,
  dirty,
  onChange
}: {
  draft: Draft;
  persisted: Draft;
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
      providerId === "searxng" ? { baseUrl: "" } : {}
    ));
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="web-search-provider" className={fieldLabel}>Web search engine</label>
        <p className="mb-2 text-xs text-[var(--muted)]">Choose which web search engine is available to the agent.</p>
        <select
          id="web-search-provider"
          aria-label="Web search engine"
          value={draft.providerId}
          onChange={(event) => selectProvider(event.target.value as WebSearchProviderId)}
          className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
        >
          {Object.entries(WEB_SEARCH_PROVIDER_CATALOG).map(([id, provider]) => (
            <option key={id} value={id}>{provider.label}</option>
          ))}
        </select>
      </div>

      {draft.providerId === "exa" ? (
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

      {draft.providerId === "tavily" ? (
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
            onChange={(event) => onChange({
              ...draft,
              configuration: { baseUrl: event.target.value }
            })}
            className={`${inputLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
          />
        </div>
      ) : null}
    </div>
  );
}
