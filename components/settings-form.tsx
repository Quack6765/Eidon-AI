"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Shield, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import type { AppSettings, AuthUser } from "@/lib/types";

type SettingsPayload = Omit<AppSettings, "apiKeyEncrypted"> & {
  hasApiKey: boolean;
};

export function SettingsForm({
  settings,
  user
}: {
  settings: SettingsPayload;
  user: AuthUser;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");
  const [testResult, setTestResult] = useState("");
  const [isPending] = useTransition();
  const [draftModel, setDraftModel] = useState(settings.model);
  const [draftApiMode, setDraftApiMode] = useState(settings.apiMode);
  const visibleReasoningSupported = supportsVisibleReasoning(draftModel, draftApiMode);

  async function handleSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const formData = new FormData(event.currentTarget);

    const payload = {
      apiBaseUrl: String(formData.get("apiBaseUrl") ?? ""),
      apiKey: String(formData.get("apiKey") ?? ""),
      model: String(formData.get("model") ?? ""),
      apiMode: String(formData.get("apiMode") ?? ""),
      systemPrompt: String(formData.get("systemPrompt") ?? ""),
      temperature: Number(formData.get("temperature") ?? 0),
      maxOutputTokens: Number(formData.get("maxOutputTokens") ?? 0),
      reasoningEffort: String(formData.get("reasoningEffort") ?? "medium"),
      reasoningSummaryEnabled: formData.get("reasoningSummaryEnabled") === "on",
      modelContextLimit: Number(formData.get("modelContextLimit") ?? 0),
      compactionThreshold: Number(formData.get("compactionThreshold") ?? 0),
      freshTailCount: Number(formData.get("freshTailCount") ?? 0)
    };

    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error ?? "Unable to save settings");
      return;
    }

    setSuccess("Settings saved.");
    router.refresh();
  }

  async function handleAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAccountSuccess("");
    const formData = new FormData(event.currentTarget);

    const response = await fetch("/api/auth/account", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: String(formData.get("username") ?? ""),
        password: String(formData.get("password") ?? "")
      })
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error ?? "Unable to update account");
      return;
    }

    setAccountSuccess("Account updated. Sign in again if you changed the password.");
    router.refresh();
  }

  async function runConnectionTest() {
    setTestResult("");
    const response = await fetch("/api/settings/test", { method: "POST" });
    const result = (await response.json()) as { text?: string; error?: string };
    setTestResult(result.text ?? result.error ?? "No result");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr,0.7fr]">
      <form onSubmit={(event) => void handleSettings(event)} className="panel grain rounded-[2rem] border p-6">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-[color:var(--accent)]" />
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[color:var(--accent)]">
              Runtime settings
            </p>
            <h2
              className="mt-2 text-4xl leading-none"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Provider + context controls
            </h2>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>API base URL</Label>
            <Input name="apiBaseUrl" defaultValue={settings.apiBaseUrl} required />
          </div>

          <div>
            <Label>API mode</Label>
            <select
              name="apiMode"
              defaultValue={settings.apiMode}
              onChange={(event) => setDraftApiMode(event.target.value as SettingsPayload["apiMode"])}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
            >
              <option value="responses">responses</option>
              <option value="chat_completions">chat_completions</option>
            </select>
          </div>

          <div>
            <Label>Model</Label>
            <Input
              name="model"
              defaultValue={settings.model}
              required
              onChange={(event) => setDraftModel(event.target.value)}
            />
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">
              {visibleReasoningSupported
                ? "This model can emit visible reasoning summaries through the Responses API."
                : "This model is treated as non-reasoning here, so visible thinking will stay hidden even if the toggle below is on."}
            </p>
          </div>

          <div className="md:col-span-2">
            <Label>API key</Label>
            <Input
              name="apiKey"
              type="password"
              placeholder={settings.hasApiKey ? "Stored securely. Leave blank to keep." : "sk-..."}
            />
          </div>

          <div className="md:col-span-2">
            <Label>System prompt</Label>
            <Textarea name="systemPrompt" defaultValue={settings.systemPrompt} rows={5} required />
          </div>

          <div>
            <Label>Temperature</Label>
            <Input name="temperature" type="number" step="0.1" defaultValue={settings.temperature} />
          </div>

          <div>
            <Label>Max output tokens</Label>
            <Input
              name="maxOutputTokens"
              type="number"
              defaultValue={settings.maxOutputTokens}
            />
          </div>

          <div>
            <Label>Reasoning effort</Label>
            <select
              name="reasoningEffort"
              defaultValue={settings.reasoningEffort}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
            </select>
          </div>

          <div>
            <Label>Reasoning summary</Label>
            <label className="flex h-[50px] items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm">
              <input
                name="reasoningSummaryEnabled"
                type="checkbox"
                defaultChecked={settings.reasoningSummaryEnabled}
              />
              Show reasoning when provider supports it
            </label>
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">
              Best results here come from reasoning-capable models like GPT-5 and OpenAI o-series models on the Responses API.
            </p>
          </div>

          <div>
            <Label>Model context limit</Label>
            <Input
              name="modelContextLimit"
              type="number"
              defaultValue={settings.modelContextLimit}
            />
          </div>

          <div>
            <Label>Compaction threshold</Label>
            <Input
              name="compactionThreshold"
              type="number"
              step="0.01"
              defaultValue={settings.compactionThreshold}
            />
          </div>

          <div>
            <Label>Fresh tail count</Label>
            <Input name="freshTailCount" type="number" defaultValue={settings.freshTailCount} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit">Save settings</Button>
          <Button type="button" variant="secondary" onClick={runConnectionTest}>
            Test connection
          </Button>
          {success ? <p className="text-sm text-emerald-300">{success}</p> : null}
          {testResult ? <p className="text-sm text-[color:var(--muted)]">{testResult}</p> : null}
        </div>

        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      </form>

      <div className="space-y-5">
        <form onSubmit={(event) => void handleAccount(event)} className="panel grain rounded-[2rem] border p-6">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-sky-200" />
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-sky-200">
                Account
              </p>
              <h2
                className="mt-2 text-3xl leading-none"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Local access
              </h2>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <Label>Username</Label>
              <Input name="username" defaultValue={user.username} />
            </div>
            <div>
              <Label>New password</Label>
              <Input name="password" type="password" placeholder="Leave blank to keep current password" />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <Button type="submit" variant="secondary">
              Update account
            </Button>
            {accountSuccess ? <p className="text-sm text-emerald-300">{accountSuccess}</p> : null}
          </div>
        </form>

        <div className="panel grain rounded-[2rem] border p-6">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[color:var(--accent)]">
            Session
          </p>
          <h2
            className="mt-2 text-3xl leading-none"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {user.username}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
            The app runs as a single private workspace with secure cookie sessions and encrypted provider credentials.
          </p>
          <Button variant="danger" className="mt-6 gap-2" onClick={logout} disabled={isPending}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
