"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import type { McpServer, McpTransport } from "@/lib/types";
import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";

export function McpServersSection() {
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpTransport, setMcpTransport] = useState<McpTransport>("streamable_http");
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpEnv, setMcpEnv] = useState("");
  const [editingMcpId, setEditingMcpId] = useState<string | null>(null);
  const [mcpDraftTestResult, setMcpDraftTestResult] = useState<{ text: string; isSuccess: boolean } | null>(null);
  const [mcpRowTestResults, setMcpRowTestResults] = useState<Record<string, { text: string; isSuccess: boolean }>>({});
  const [mcpTestingTarget, setMcpTestingTarget] = useState<string | null>(null);
  const [mcpEnabledDraft, setMcpEnabledDraft] = useState(true);
  const toast = useToastState();

  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);

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
      transport: mcpTransport,
      enabled: mcpEnabledDraft
    };

    if (mcpTransport === "streamable_http") {
      payload.url = mcpUrl;
      payload.headers = headersObj;
    } else {
      payload.command = mcpCommand;
      if (argsArr) payload.args = argsArr;
      if (envObj) payload.env = envObj;
    }

    let savedId = editingMcpId;

    if (editingMcpId) {
      const patchRes = await fetch(`/api/mcp-servers/${editingMcpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!patchRes.ok) {
        const errorData = await patchRes.json().catch(() => null);
        toast.showToast("error", errorData?.error ?? "Failed to update server");
        return;
      }
    } else {
      const postRes = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!postRes.ok) {
        const errorData = await postRes.json().catch(() => null);
        toast.showToast("error", errorData?.error ?? "Failed to add server");
        return;
      }
      const created = (await postRes.json()) as { server: McpServer };
      savedId = created.server.id;

      if (savedId && mcpEnabledDraft === false) {
        await fetch(`/api/mcp-servers/${savedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false })
        });
      }
    }

    const res = await fetch("/api/mcp-servers");
    const data = (await res.json()) as { servers: McpServer[] };
    setMcpServers(data.servers);

    const savedServer = data.servers.find((s) => s.id === savedId);
    if (savedServer) {
      setSelectedServerId(savedServer.id);
      setEditingMcpId(savedServer.id);
      setMcpName(savedServer.name);
      setMcpTransport(savedServer.transport ?? "streamable_http");
      setMcpUrl(savedServer.url);
      setMcpHeaders(JSON.stringify(savedServer.headers, null, 2));
      setMcpCommand(savedServer.command ?? "");
      setMcpArgs(savedServer.args ? JSON.stringify(savedServer.args) : "");
      setMcpEnv(savedServer.env ? JSON.stringify(savedServer.env, null, 2) : "");
      setMcpEnabledDraft(savedServer.enabled);
      setMcpDraftTestResult(null);
      setIsAddingNew(false);
      setMobileDetailVisible(true);
    }

    toast.showToast("success", "MCP saved.");
  }

  async function testMcpServer(serverId?: string) {
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
      const result = (await response.json()) as { text?: string; error?: string; toolCount?: number; stderr?: string };
      const message = result.text ?? result.error ?? "No result";
      const fullMessage = result.stderr ? `${message}\n${result.stderr}` : message;
      const isSuccess = response.ok && !result.error;

      if (serverId) {
        setMcpRowTestResults((current) => ({
          ...current,
          [serverId]: { text: fullMessage, isSuccess }
        }));
      } else {
        setMcpDraftTestResult({ text: fullMessage, isSuccess });
      }

      if (!response.ok) {
        toast.showToast("error", fullMessage);
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "MCP connection test failed";
      if (serverId) {
        setMcpRowTestResults((current) => ({
          ...current,
          [serverId]: { text: message, isSuccess: false }
        }));
      } else {
        setMcpDraftTestResult({ text: message, isSuccess: false });
      }
      toast.showToast("error", message);
    } finally {
      setMcpTestingTarget(null);
    }
  }

  async function deleteMcpServer(id: string) {
    await fetch(`/api/mcp-servers/${id}`, { method: "DELETE" });
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
    if (selectedServerId === id) {
      setSelectedServerId(null);
      setIsAddingNew(false);
      setMobileDetailVisible(false);
    }
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
    setMcpDraftTestResult(mcpRowTestResults[server.id] ?? null);
    setMcpEnabledDraft(server.enabled);
  }

  function resetMcpForm() {
    setMcpTransport("streamable_http");
    setMcpName("");
    setMcpUrl("");
    setMcpHeaders("");
    setMcpCommand("");
    setMcpArgs("");
    setMcpEnv("");
    setMcpEnabledDraft(true);
    setEditingMcpId(null);
    setMcpDraftTestResult(null);
    setSelectedServerId(null);
    setIsAddingNew(false);
  }

  function handleSelectServer(server: McpServer) {
    editMcpServer(server);
    setSelectedServerId(server.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
  }

  function handleAddNew() {
    resetMcpForm();
    setIsAddingNew(true);
    setSelectedServerId(null);
    setMobileDetailVisible(true);
  }

  const selectedServer = mcpServers.find((s) => s.id === selectedServerId);
  const showDetail = selectedServerId !== null || isAddingNew;

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike = "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const selectLike = `${inputLike} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10`;
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

  return (
    <div className="min-h-0 p-4 md:h-full md:p-8">
      <SettingsSplitPane
        isDetailVisible={mobileDetailVisible}
        onBackAction={() => setMobileDetailVisible(false)}
        listHeader={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--text)]">MCP Servers</h2>
              <span className="text-xs text-[var(--muted)]">{mcpServers.length}</span>
            </div>
            <button
              onClick={handleAddNew}
              aria-label="Add MCP server"
              title="Add MCP server"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--text)]"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        }
        listPanel={
          <div className="space-y-1">
            {mcpServers.map((server) => (
                <ProfileCard
                  key={server.id}
                  isActive={server.id === selectedServerId}
                  isDisabled={!server.enabled}
                  onClick={() => handleSelectServer(server)}
                  title={server.name}
                  subtitle={
                    server.transport === "stdio"
                    ? `${server.command}${server.args?.length ? " " + server.args.join(" ") : ""}`
                    : server.url
                }
                badges={[
                  server.transport === "stdio"
                    ? { variant: "stdio" as const, label: "STDIO" }
                    : { variant: "http" as const, label: "HTTP" }
                ]}
              />
            ))}
            {mcpServers.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                No servers configured
              </div>
            )}
          </div>
        }
        detailPanel={
          showDetail ? (
            <div className="space-y-0">
              <div className="pb-5">
                <h3 className="text-base font-semibold text-[var(--text)]">
                  {isAddingNew ? "Add MCP Server" : selectedServer?.name ?? "Server"}
                </h3>
              </div>

              <div className={`${sectionDivider} py-5`}>
                <div className="space-y-3">
                <div>
                  <label className={fieldLabel}>Name</label>
                  <Input
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                    placeholder="My MCP Server"
                  />
                </div>
                <div>
                  <label className={fieldLabel}>Transport</label>
                  <select
                    value={mcpTransport}
                    onChange={(e) => setMcpTransport(e.target.value as McpTransport)}
                    className={selectLike}
                  >
                    <option value="streamable_http">Streamable HTTP</option>
                    <option value="stdio">Local stdio</option>
                  </select>
                </div>
                {mcpTransport === "streamable_http" ? (
                  <>
                    <div>
                      <label className={fieldLabel}>URL</label>
                      <Input
                        value={mcpUrl}
                        onChange={(e) => setMcpUrl(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Headers (JSON)</label>
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
                      <label className={fieldLabel}>Command</label>
                      <Input
                        value={mcpCommand}
                        onChange={(e) => setMcpCommand(e.target.value)}
                        placeholder="uvx or npx"
                      />
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Use &quot;uvx&quot; for Python-based servers or &quot;npx&quot; for Node.js-based servers.
                      </p>
                    </div>
                    <div>
                      <label className={fieldLabel}>Args (JSON array or space-separated)</label>
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
                      <label className={fieldLabel}>Environment variables (JSON, optional)</label>
                      <Textarea
                        value={mcpEnv}
                        onChange={(e) => setMcpEnv(e.target.value)}
                        placeholder='{"API_KEY": "..."}'
                        rows={2}
                      />
                    </div>
                  </>
                )}
              </div>

              {editingMcpId ? (
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)]">
                    <input
                      type="checkbox"
                      checked={mcpEnabledDraft}
                      onChange={(e) => setMcpEnabledDraft(e.target.checked)}
                    />
                    Enabled
                  </label>
                </div>
              ) : null}
              </div>

              <div className={`${sectionDivider} py-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" className="px-3 py-1.5 text-xs" onClick={() => void saveMcpServer()}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2.5 py-1.5 text-xs"
                    onClick={() => void testMcpServer()}
                    disabled={mcpTestingTarget === "draft"}
                  >
                    {mcpTestingTarget === "draft" ? "Testing" : "Test"}
                  </Button>
                </div>
                {editingMcpId && (
                  <button
                    type="button"
                    onClick={() => deleteMcpServer(editingMcpId)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
              </div>

              <Toast
                visible={toast.visible}
                variant={toast.variant}
                message={toast.message}
              />

              {mcpDraftTestResult && (
                <p className={`pt-2 text-sm ${mcpDraftTestResult.isSuccess ? "text-emerald-400" : "text-red-300"}`}>
                  {mcpDraftTestResult.text}
                </p>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-[var(--muted)]">Select a server or add a new one</p>
            </div>
          )
        }
      />
    </div>
  );
}
