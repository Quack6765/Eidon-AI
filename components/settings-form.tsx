"use client";

import { FormEvent, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Shield, Sparkles, Server, Zap, Plus, Trash2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import type { AppSettings, AuthUser, McpServer, McpTransport, Skill } from "@/lib/types";

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

  // MCP Servers state
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [mcpTransport, setMcpTransport] = useState<McpTransport>("streamable_http");
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpEnv, setMcpEnv] = useState("");
  const [editingMcpId, setEditingMcpId] = useState<string | null>(null);

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mcp-servers")
      .then((r) => r.json())
      .then((d) => { if (d.servers) setMcpServers(d.servers); })
      .catch(() => {});
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => { if (d.skills) setSkills(d.skills); })
      .catch(() => {});
  }, []);

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
  }

  async function handleAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAccountSuccess("");
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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

  // MCP Server handlers
  async function saveMcpServer() {
    if (!mcpName.trim()) return;
    if (mcpTransport === "streamable_http" && !mcpUrl.trim()) return;
    if (mcpTransport === "stdio" && !mcpCommand.trim()) return;

    let headersObj: Record<string, string> = {};
    if (mcpTransport === "streamable_http" && mcpHeaders.trim()) {
      try { headersObj = JSON.parse(mcpHeaders); } catch { headersObj = {}; }
    }

    let argsArr: string[] | undefined;
    if (mcpTransport === "stdio" && mcpArgs.trim()) {
      try {
        const parsed = JSON.parse(mcpArgs);
        argsArr = Array.isArray(parsed) ? parsed : mcpArgs.split(/\s+/).filter(Boolean);
      } catch {
        argsArr = mcpArgs.split(/\s+/).filter(Boolean);
      }
    }

    let envObj: Record<string, string> | undefined;
    if (mcpTransport === "stdio" && mcpEnv.trim()) {
      try { envObj = JSON.parse(mcpEnv); } catch { envObj = undefined; }
    }

    const payload: Record<string, unknown> = {
      name: mcpName,
      transport: mcpTransport
    };

    if (mcpTransport === "streamable_http") {
      payload.url = mcpUrl;
      payload.headers = headersObj;
    } else {
      payload.command = mcpCommand;
      if (argsArr) payload.args = argsArr;
      if (envObj) payload.env = envObj;
    }

    if (editingMcpId) {
      await fetch(`/api/mcp-servers/${editingMcpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    const res = await fetch("/api/mcp-servers");
    const data = await res.json() as { servers: McpServer[] };
    setMcpServers(data.servers);
    resetMcpForm();
  }

  async function deleteMcpServer(id: string) {
    await fetch(`/api/mcp-servers/${id}`, { method: "DELETE" });
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
  }

  async function toggleMcpServer(id: string, enabled: boolean) {
    await fetch(`/api/mcp-servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    setMcpServers((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
  }

  function editMcpServer(server: McpServer) {
    setEditingMcpId(server.id);
    setMcpName(server.name);
    setMcpTransport(server.transport ?? "streamable_http");
    setMcpUrl(server.url);
    setMcpHeaders(JSON.stringify(server.headers, null, 2));
    setMcpCommand(server.command ?? "");
    setMcpArgs(server.args ? JSON.stringify(server.args) : "");
    setMcpEnv(server.env ? JSON.stringify(server.env, null, 2) : "");
    setShowMcpForm(true);
  }

  function resetMcpForm() {
    setShowMcpForm(false);
    setMcpTransport("streamable_http");
    setMcpName("");
    setMcpUrl("");
    setMcpHeaders("");
    setMcpCommand("");
    setMcpArgs("");
    setMcpEnv("");
    setEditingMcpId(null);
  }

  // Skill handlers
  async function saveSkill() {
    if (!skillName.trim() || !skillContent.trim()) return;

    if (editingSkillId) {
      await fetch(`/api/skills/${editingSkillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: skillName, content: skillContent })
      });
    } else {
      await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: skillName, content: skillContent })
      });
    }

    const res = await fetch("/api/skills");
    const data = await res.json() as { skills: Skill[] };
    setSkills(data.skills);
    resetSkillForm();
  }

  async function deleteSkill(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    setSkills((prev) => prev.filter((s) => s.id !== id));
  }

  async function toggleSkill(id: string, enabled: boolean) {
    await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    setSkills((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
  }

  function editSkill(skill: Skill) {
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillContent(skill.content);
    setShowSkillForm(true);
  }

  function resetSkillForm() {
    setShowSkillForm(false);
    setSkillName("");
    setSkillContent("");
    setEditingSkillId(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr,0.7fr]">
      {/* Left column: Provider settings + MCP + Skills */}
      <div className="space-y-5">
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
              <Label>System prompt (applied to new conversations only)</Label>
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

        {/* MCP Servers Section */}
        <div className="panel grain rounded-[2rem] border p-6">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-sky-300" />
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-sky-300">
                Integrations
              </p>
              <h2
                className="mt-2 text-4xl leading-none"
                style={{ fontFamily: "var(--font-display)" }}
              >
                MCP Servers
              </h2>
            </div>
          </div>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            Add HTTP streamable or local stdio MCP servers to make external tools available in chat.
          </p>

          <div className="mt-4 space-y-3">
            {mcpServers.map((server) => (
              <div key={server.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text)]">{server.name}</span>
                    {server.transport === "stdio" ? (
                      <span className="inline-flex items-center rounded-md bg-emerald-900/40 px-1.5 py-0.5 text-[0.65rem] font-medium text-emerald-300">
                        stdio
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-sky-900/40 px-1.5 py-0.5 text-[0.65rem] font-medium text-sky-300">
                        http
                      </span>
                    )}
                    <span className="text-xs text-white/30">
                      {server.transport === "stdio"
                        ? `${server.command}${server.args?.length ? " " + server.args.join(" ") : ""}`
                        : server.url}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <label className="flex items-center gap-1.5 text-xs text-white/50">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={(e) => toggleMcpServer(server.id, e.target.checked)}
                      className="rounded"
                    />
                    On
                  </label>
                  <button onClick={() => editMcpServer(server)} className="p-1 text-white/40 hover:text-white transition">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteMcpServer(server.id)} className="p-1 text-red-400/60 hover:text-red-400 transition">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {showMcpForm ? (
              <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
                <div>
                  <Label>Name</Label>
                  <Input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="My MCP Server" />
                </div>
                <div>
                  <Label>Transport</Label>
                  <select
                    value={mcpTransport}
                    onChange={(e) => setMcpTransport(e.target.value as McpTransport)}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
                  >
                    <option value="streamable_http">Streamable HTTP</option>
                    <option value="stdio">Local stdio</option>
                  </select>
                </div>
                {mcpTransport === "streamable_http" ? (
                  <>
                    <div>
                      <Label>URL</Label>
                      <Input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://..." />
                    </div>
                    <div>
                      <Label>Headers (JSON)</Label>
                      <Textarea
                        value={mcpHeaders}
                        onChange={(e) => setMcpHeaders(e.target.value)}
                        placeholder='{"Authorization": "Bearer ..."}'
                        rows={2}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <Label>Command</Label>
                      <Input value={mcpCommand} onChange={(e) => setMcpCommand(e.target.value)} placeholder="uvx or npx" />
                      <p className="mt-1 text-xs text-white/30">
                        Use &quot;uvx&quot; for Python-based servers or &quot;npx&quot; for Node.js-based servers.
                      </p>
                    </div>
                    <div>
                      <Label>Args (JSON array or space-separated)</Label>
                      <Input
                        value={mcpArgs}
                        onChange={(e) => setMcpArgs(e.target.value)}
                        placeholder={mcpCommand === "npx" ? "-y @modelcontextprotocol/server-fetch" : "mcp-server-fetch"}
                      />
                    </div>
                    <div>
                      <Label>Environment variables (JSON, optional)</Label>
                      <Textarea
                        value={mcpEnv}
                        onChange={(e) => setMcpEnv(e.target.value)}
                        placeholder='{"API_KEY": "..."}'
                        rows={2}
                      />
                    </div>
                  </>
                )}
                <div className="flex gap-2">
                  <Button type="button" onClick={saveMcpServer}>
                    {editingMcpId ? "Update" : "Add server"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={resetMcpForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={() => setShowMcpForm(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Add MCP server
              </Button>
            )}
          </div>
        </div>

        {/* Skills Section */}
        <div className="panel grain rounded-[2rem] border p-6">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-amber-300" />
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-amber-300">
                Prompts
              </p>
              <h2
                className="mt-2 text-4xl leading-none"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Skills
              </h2>
            </div>
          </div>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            Define reusable skills that are injected into the system prompt for all chats when enabled.
          </p>

          <div className="mt-4 space-y-3">
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text)]">{skill.name}</span>
                    <span className="text-xs text-white/30 truncate max-w-[200px]">{skill.content.slice(0, 60)}...</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <label className="flex items-center gap-1.5 text-xs text-white/50">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={(e) => toggleSkill(skill.id, e.target.checked)}
                      className="rounded"
                    />
                    On
                  </label>
                  <button onClick={() => editSkill(skill)} className="p-1 text-white/40 hover:text-white transition">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteSkill(skill.id)} className="p-1 text-red-400/60 hover:text-red-400 transition">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {showSkillForm ? (
              <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
                <div>
                  <Label>Name</Label>
                  <Input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="Skill name" />
                </div>
                <div>
                  <Label>Instructions / Prompt</Label>
                  <Textarea
                    value={skillContent}
                    onChange={(e) => setSkillContent(e.target.value)}
                    placeholder="Enter the skill instructions..."
                    rows={4}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={saveSkill}>
                    {editingSkillId ? "Update" : "Add skill"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={resetSkillForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={() => setShowSkillForm(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Add skill
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Right column: Account + Session */}
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

        {/* Active Skills Summary */}
        {skills.filter((s) => s.enabled).length > 0 && (
          <div className="panel grain rounded-[2rem] border p-6">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-amber-300">
              Active skills
            </p>
            <div className="mt-3 space-y-2">
              {skills.filter((s) => s.enabled).map((skill) => (
                <div key={skill.id} className="flex items-center gap-2 text-sm text-[var(--text)]">
                  <Zap className="h-3 w-3 text-amber-400" />
                  {skill.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active MCP Summary */}
        {mcpServers.filter((s) => s.enabled).length > 0 && (
          <div className="panel grain rounded-[2rem] border p-6">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-sky-300">
              Active MCP servers
            </p>
            <div className="mt-3 space-y-2">
              {mcpServers.filter((s) => s.enabled).map((server) => (
                <div key={server.id} className="flex items-center gap-2 text-sm text-[var(--text)]">
                  <Server className="h-3 w-3 text-sky-400" />
                  {server.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
