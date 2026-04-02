"use client";

import { useEffect, useState } from "react";
import { Server, Plus, Trash2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { McpServer, McpTransport } from "@/lib/types";

export function McpServersSection() {
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
  const [mcpDraftTestResult, setMcpDraftTestResult] = useState("");
  const [mcpRowTestResults, setMcpRowTestResults] = useState<Record<string, string>>({});
  const [mcpTestingTarget, setMcpTestingTarget] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/mcp-servers")
      .then((r) => r.json())
      .then((d) => {
        if (d.servers) setMcpServers(d.servers);
      })
      .catch(() => {});
  }, []);

  async function saveMcpServer() {
    if (!mcpName.trim()) return;
    if (mcpTransport === "streamable_http" && !mcpUrl.trim()) return;
    if (mcpTransport === "stdio" && !mcpCommand.trim()) return;

    let headersObj: Record<string, string> = {};
    if (mcpTransport === "streamable_http" && mcpHeaders.trim()) {
      try {
        headersObj = JSON.parse(mcpHeaders);
      } catch {
        headersObj = {};
      }
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
      try {
        envObj = JSON.parse(mcpEnv);
      } catch {
        envObj = undefined;
      }
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
    const data = (await res.json()) as { servers: McpServer[] };
    setMcpServers(data.servers);
    resetMcpForm();
  }

  async function testMcpServer(serverId?: string) {
    setError("");
    const target = serverId ?? "draft";
    setMcpTestingTarget(target);

    try {
      let payload: Record<string, unknown>;

      if (serverId) {
        payload = { serverId };
      } else {
        if (!mcpName.trim()) return;
        if (mcpTransport === "streamable_http" && !mcpUrl.trim()) return;
        if (mcpTransport === "stdio" && !mcpCommand.trim()) return;

        payload = {
          name: mcpName,
          transport: mcpTransport
        };

        if (mcpTransport === "streamable_http") {
          payload.url = mcpUrl;
          payload.headers = mcpHeaders.trim() ? JSON.parse(mcpHeaders) : {};
        } else {
          payload.command = mcpCommand;
          payload.args = mcpArgs.trim()
            ? (() => {
                try {
                  const parsed = JSON.parse(mcpArgs);
                  return Array.isArray(parsed) ? parsed : mcpArgs.split(/\s+/).filter(Boolean);
                } catch {
                  return mcpArgs.split(/\s+/).filter(Boolean);
                }
              })()
            : [];
          payload.env = mcpEnv.trim() ? JSON.parse(mcpEnv) : {};
          payload.url = "";
          payload.headers = {};
        }
      }

      const response = await fetch("/api/mcp-servers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as { text?: string; error?: string; toolCount?: number };
      const message = result.text ?? result.error ?? "No result";

      if (serverId) {
        setMcpRowTestResults((current) => ({
          ...current,
          [serverId]: message
        }));
      } else {
        setMcpDraftTestResult(message);
      }

      if (!response.ok) {
        setError(message);
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "MCP connection test failed";
      if (serverId) {
        setMcpRowTestResults((current) => ({
          ...current,
          [serverId]: message
        }));
      } else {
        setMcpDraftTestResult(message);
      }
      setError(message);
    } finally {
      setMcpTestingTarget(null);
    }
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
    setMcpServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
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
    setMcpDraftTestResult(mcpRowTestResults[server.id] ?? "");
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
    setMcpDraftTestResult("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          MCP Servers
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Add HTTP streamable or local stdio MCP servers to make external tools available in chat.
        </p>
      </div>

      <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-400">
              Integrations
            </p>
            <h2
              className="mt-1 text-3xl leading-none text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              MCP Servers
            </h2>
          </div>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Add HTTP streamable or local stdio MCP servers to make external tools available in chat.
        </p>

        <div className="space-y-2">
          {mcpServers.map((server) => (
            <div
              key={server.id}
              className="rounded-xl border border-white/4 bg-white/[0.01] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text)]">{server.name}</span>
                    {server.transport === "stdio" ? (
                      <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                        stdio
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400">
                        http
                      </span>
                    )}
                    <span className="truncate text-xs text-white/20">
                      {server.transport === "stdio"
                        ? `${server.command}${server.args?.length ? " " + server.args.join(" ") : ""}`
                        : server.url}
                    </span>
                  </div>
                </div>
                <div className="ml-2 flex items-center gap-2">
                  <button
                    onClick={() => void testMcpServer(server.id)}
                    className="rounded-md border border-white/6 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-white/45 transition-colors duration-200 hover:text-white"
                    disabled={mcpTestingTarget === server.id}
                  >
                    {mcpTestingTarget === server.id ? "Testing" : "Retest"}
                  </button>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-white/40">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={(e) => toggleMcpServer(server.id, e.target.checked)}
                      className="rounded"
                    />
                    On
                  </label>
                  <button
                    onClick={() => editMcpServer(server)}
                    className="p-1 text-white/30 transition-colors duration-200 hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteMcpServer(server.id)}
                    className="p-1 text-red-400/40 transition-colors duration-200 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {mcpRowTestResults[server.id] ? (
                <p className="mt-2 truncate text-xs text-white/30">{mcpRowTestResults[server.id]}</p>
              ) : null}
            </div>
          ))}

          {showMcpForm ? (
            <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4 animate-fade-in">
              <div>
                <Label>Name</Label>
                <Input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="My MCP Server"
                />
              </div>
              <div>
                <Label>Transport</Label>
                <select
                  value={mcpTransport}
                  onChange={(e) => setMcpTransport(e.target.value as McpTransport)}
                  className="w-full rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]/30 transition-all duration-200"
                >
                  <option value="streamable_http">Streamable HTTP</option>
                  <option value="stdio">Local stdio</option>
                </select>
              </div>
              {mcpTransport === "streamable_http" ? (
                <>
                  <div>
                    <Label>URL</Label>
                    <Input
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                      placeholder="https://..."
                    />
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
                    <Input
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                      placeholder="uvx or npx"
                    />
                    <p className="mt-1 text-xs text-white/20">
                      Use &quot;uvx&quot; for Python-based servers or &quot;npx&quot; for Node.js-based servers.
                    </p>
                  </div>
                  <div>
                    <Label>Args (JSON array or space-separated)</Label>
                    <Input
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                      placeholder={
                        mcpCommand === "npx"
                          ? "-y @modelcontextprotocol/server-fetch"
                          : "mcp-server-fetch"
                      }
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
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void testMcpServer()}
                  disabled={mcpTestingTarget === "draft"}
                >
                  {mcpTestingTarget === "draft" ? "Testing" : "Test"}
                </Button>
                <Button type="button" onClick={saveMcpServer}>
                  {editingMcpId ? "Update" : "Add server"}
                </Button>
                <Button type="button" variant="secondary" onClick={resetMcpForm}>
                  Cancel
                </Button>
              </div>
              {mcpDraftTestResult ? (
                <p className="text-xs text-white/35">{mcpDraftTestResult}</p>
              ) : null}
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowMcpForm(true)}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add MCP server
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}
