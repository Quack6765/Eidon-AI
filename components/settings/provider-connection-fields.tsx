import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ProviderDeviceCode, type DeviceCodeFlow } from "@/components/settings/provider-device-code";
import { ProviderUsageLimits } from "@/components/settings/provider-usage-limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDER_CATALOG } from "@/lib/provider-catalog";
import type { ProviderProfileEditorDraft } from "@/lib/provider-profile-editor";
import type { ProviderProfileSummary } from "@/lib/provider-profile";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import { useStableHandler } from "@/lib/use-stable-handler";

type DiscoveredModel = {
  id: string;
  name: string;
  maxContextWindowTokens: number | null;
};

const DEVICE_FLOW_POLL_MS = 3000;

type ConnectionFieldProps = {
  profile: ProviderProfileEditorDraft;
  models: DiscoveredModel[];
  dirty: boolean;
  onChange(profile: ProviderProfileEditorDraft): void;
  onSave(): Promise<boolean>;
  onError(message: string): void;
};

function describeConnection(profile: ProviderProfileEditorDraft, providerLabel: string) {
  if (profile.connection.status === "connected") {
    return `Connected as ${profile.connection.accountLabel ?? "account"}`;
  }
  if (profile.connection.status === "expired") {
    return `The ${providerLabel} session has expired. Reconnect to keep chatting.`;
  }
  return `No ${providerLabel} account connected`;
}

function OAuthConnectionFields({
  profile,
  models,
  dirty,
  onChange,
  onSave,
  onError
}: ConnectionFieldProps) {
  const provider = PROVIDER_CATALOG[profile.providerKind];
  const [deviceFlow, setDeviceFlow] = useState<DeviceCodeFlow | null>(null);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const refreshConnection = useStableHandler(async () => {
    const response = await fetch("/api/settings");
    const result = await response.json().catch(() => ({})) as {
      settings?: { providerProfiles?: ProviderProfileSummary[] };
    };
    const saved = result.settings?.providerProfiles?.find((entry) => entry.id === profileRef.current.id);
    if (saved) onChange({ ...profileRef.current, connection: saved.connection });
  });

  useEffect(() => {
    setDeviceFlow(null);
    setFlowMessage(null);
  }, [profile.id]);

  useEffect(() => {
    if (!deviceFlow) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/providers/${profileRef.current.id}/connection/flows/${deviceFlow.flowId}`
        );
        const result = await response.json().catch(() => ({})) as {
          flow?: { status: string };
          error?: string;
        };
        if (!active) return;
        const status = result.flow?.status;
        if (status === "succeeded") {
          setDeviceFlow(null);
          await refreshConnection();
          return;
        }
        if (!response.ok || status === "failed" || status === "canceled") {
          setDeviceFlow(null);
          setFlowMessage(
            Date.parse(deviceFlow.expiresAt) <= Date.now()
              ? "The sign-in code expired. Connect again to get a new one."
              : result.error ?? "Sign-in did not finish. Connect again to retry."
          );
        }
      } catch {
        if (active) setFlowMessage("Lost contact with the server while waiting. Connect again to retry.");
      }
    };
    const timer = window.setInterval(() => void poll(), DEVICE_FLOW_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [deviceFlow, refreshConnection]);

  async function startConnection() {
    setFlowMessage(null);
    setStarting(true);
    try {
      if (!await onSave()) return;
      const response = await fetch(`/api/providers/${profile.id}/connection/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: "browser" })
      });
      const result = await response.json() as Partial<DeviceCodeFlow> & { error?: string };
      if (!response.ok || !result.authorizationUrl) {
        setFlowMessage(result.error ?? "Unable to start provider connection");
        return;
      }
      if (result.userCode && result.flowId && result.expiresAt) {
        setDeviceFlow({
          flowId: result.flowId,
          userCode: result.userCode,
          authorizationUrl: result.authorizationUrl,
          expiresAt: result.expiresAt
        });
        return;
      }
      window.location.assign(result.authorizationUrl);
    } catch {
      onError("Unable to start provider connection");
    } finally {
      setStarting(false);
    }
  }

  async function cancelConnection() {
    const flow = deviceFlow;
    setDeviceFlow(null);
    if (!flow) return;
    await fetch(`/api/providers/${profile.id}/connection/flows/${flow.flowId}`, { method: "DELETE" })
      .catch(() => undefined);
  }

  return (
    <div className="mt-4 space-y-4">
      {deviceFlow ? (
        <ProviderDeviceCode
          flow={deviceFlow}
          providerLabel={provider.label}
          onCancel={() => void cancelConnection()}
        />
      ) : (
        <>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <p
              className={`text-sm ${
                profile.connection.status === "connected"
                  ? "text-[var(--text)]"
                  : profile.connection.status === "expired"
                    ? "text-amber-400"
                    : "text-[var(--muted)]"
              }`}
            >
              {describeConnection(profile, provider.label)}
            </p>
            {provider.access === "owner" ? (
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {profile.connection.status === "disconnected"
                  ? "Private to the administrator who connects it. Other people on this server cannot see or use it."
                  : "Private to the administrator who connected it. Other people on this server cannot see or use it."}
              </p>
            ) : null}
            {flowMessage ? (
              <p className="mt-2 text-xs leading-5 text-amber-400" role="alert">{flowMessage}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="px-3 py-1.5 text-xs"
              disabled={starting}
              onClick={() => void startConnection()}
            >
              {starting
                ? "Starting…"
                : profile.connection.status === "disconnected"
                  ? `Connect ${provider.label}`
                  : `Reconnect ${provider.label}`}
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
        </>
      )}
      {provider.usageLimits && profile.connection.status === "connected" && !deviceFlow ? (
        <ProviderUsageLimits profileId={profile.id} />
      ) : null}
      {models.length ? (
        <div>
          <label className={fieldLabel} htmlFor={`provider-model-${profile.id}`}>Model</label>
          <select
            id={`provider-model-${profile.id}`}
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
            {models.some((model) => model.id === profile.model) ? null : (
              <option value={profile.model} disabled>
                {profile.model ? `${profile.model} (unavailable)` : "Choose a model"}
              </option>
            )}
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
      <OAuthConnectionFields
        profile={profile}
        models={models}
        dirty={dirty}
        onChange={onChange}
        onSave={onSave}
        onError={onError}
      />
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
