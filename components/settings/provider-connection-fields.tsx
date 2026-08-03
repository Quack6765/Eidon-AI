import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDER_CATALOG } from "@/lib/provider-catalog";
import type { ProviderProfileEditorDraft } from "@/lib/provider-profile-editor";
import { fieldLabel, selectLike } from "@/lib/settings-styles";

type DiscoveredModel = {
  id: string;
  name: string;
  maxContextWindowTokens: number | null;
};

export function ProviderConnectionFields({
  profile,
  models,
  dirty,
  onChange,
  onSave,
  onError
}: {
  profile: ProviderProfileEditorDraft;
  models: DiscoveredModel[];
  dirty: boolean;
  onChange(profile: ProviderProfileEditorDraft): void;
  onSave(): Promise<boolean>;
  onError(message: string): void;
}) {
  const [showCredential, setShowCredential] = useState(false);
  const provider = PROVIDER_CATALOG[profile.providerKind];

  if (profile.connection.mode === "oauth") {
    return (
      <div className="mt-4 space-y-4">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[var(--text)]">
          {profile.connection.status === "connected"
            ? `Connected as ${profile.connection.accountLabel ?? "account"}`
            : `No ${provider.label} account connected`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            onClick={async () => {
              try {
                if (!await onSave()) return;
                const response = await fetch(`/api/providers/${profile.id}/connection/flows`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ client: "browser" })
                });
                const result = await response.json() as { authorizationUrl?: string; error?: string };
                if (!response.ok || !result.authorizationUrl) {
                  onError(result.error ?? "Unable to start provider connection");
                  return;
                }
                window.location.assign(result.authorizationUrl);
              } catch {
                onError("Unable to start provider connection");
              }
            }}
          >
            {profile.connection.status === "connected" ? `Reconnect ${provider.label}` : `Connect ${provider.label}`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-2.5 py-1.5 text-xs"
            onClick={async () => {
              try {
                const response = await fetch(`/api/providers/${profile.id}/connection`, {
                  method: "DELETE"
                });
                if (!response.ok) {
                  const result = await response.json().catch(() => ({})) as { error?: string };
                  onError(result.error ?? "Unable to disconnect provider");
                  return;
                }
                onChange({
                  ...profile,
                  connection: {
                    ...profile.connection,
                    status: "disconnected",
                    accountLabel: null,
                    expiresAt: null
                  }
                });
              } catch {
                onError("Unable to disconnect provider");
              }
            }}
            disabled={profile.connection.status === "disconnected"}
          >
            Disconnect
          </Button>
        </div>
        {models.length ? (
          <div>
            <label className={fieldLabel}>Model</label>
            <select
              value={profile.model}
              onChange={(event) => {
                const selected = models.find((model) => model.id === event.target.value);
                onChange({
                  ...profile,
                  model: event.target.value,
                  ...(selected?.maxContextWindowTokens
                    ? { modelContextLimit: selected.maxContextWindowTokens }
                    : {})
                });
              }}
              className={`${selectLike} ${dirty ? "!border-amber-500/40" : ""}`}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className={fieldLabel}>Model</label>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[var(--muted)]">
              Connect the provider to browse models
            </div>
          </div>
        )}
      </div>
    );
  }

  const apiBaseUrl = profile.providerConfig.apiBaseUrl;
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={fieldLabel}>API base URL</label>
          <Input
            name="provider-api-base-url"
            autoComplete="url"
            value={apiBaseUrl}
            onChange={(event) => onChange({
              ...profile,
              providerConfig: { ...profile.providerConfig, apiBaseUrl: event.target.value },
              providerPresetId: null,
              credential: "",
              credentialAction: "clear",
              connection: {
                ...profile.connection,
                status: "disconnected",
                accountLabel: null,
                expiresAt: null
              }
            } as ProviderProfileEditorDraft)}
            required
            className={dirty ? "!border-amber-500/40" : ""}
          />
        </div>
        <div>
          <label className={fieldLabel}>Model</label>
          <Input
            name="provider-model"
            autoComplete="off"
            value={profile.model}
            onChange={(event) => onChange({ ...profile, model: event.target.value })}
            required
            className={dirty ? "!border-amber-500/40" : ""}
          />
        </div>
      </div>
      <div>
        <label className={fieldLabel}>API key</label>
        <div className="relative">
          <Input
            name="provider-credential"
            autoComplete="new-password"
            spellCheck={false}
            type={showCredential ? "text" : "password"}
            value={profile.credential}
            onChange={(event) => onChange({
              ...profile,
              credential: event.target.value,
              credentialAction: event.target.value ? "replace" : "clear"
            })}
            placeholder={profile.connection.status !== "disconnected" ? "••••••••" : "Required"}
            className={`pr-10 ${dirty ? "!border-amber-500/40" : ""}`}
          />
          <button
            type="button"
            aria-label={showCredential ? "Hide API key" : "Show API key"}
            onClick={() => setShowCredential((visible) => !visible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            {showCredential ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {profile.connection.status !== "disconnected" && profile.credentialAction === "preserve" ? (
          <button
            type="button"
            className="mt-2 text-xs text-red-400/80 transition-colors hover:text-red-300"
            onClick={() => onChange({ ...profile, credential: "", credentialAction: "clear" })}
          >
            Clear stored API key
          </button>
        ) : null}
      </div>
      {profile.providerKind === "openai_compatible" ? (
        <label className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={profile.providerConfig.reasoningParameterMode === "mirrored"}
            onChange={(event) => onChange({
              ...profile,
              providerConfig: {
                ...profile.providerConfig,
                reasoningParameterMode: event.target.checked ? "mirrored" : "standard"
              },
              providerPresetId: null
            })}
          />
          Send mirrored reasoning fields for servers that require them
        </label>
      ) : null}
    </div>
  );
}
