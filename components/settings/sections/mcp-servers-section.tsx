"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { fieldLabel, inputLike, selectLike, sectionTitle, sectionDivider } from "@/lib/settings-styles";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useToastState } from "@/hooks/use-toast-state";
import { registerUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";
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
  const [mcpIsVisionMcpDraft, setMcpIsVisionMcpDraft] = useState(false);
  const toast = useToastState();

  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);

  const { isDirty, isFieldDirty, reset: resetDirty } = useDirtyState({
    mcpName,
    mcpTransport,
    mcpUrl,
    mcpHeaders,
    mcpCommand,
    mcpArgs,
    mcpEnv,
    mcpEnabledDraft,
    mcpIsVisionMcpDraft,
  });

  useEffect(() => {
    registerUnsavedChangesGuard(
      isDirty
        ? {
            isDirty: () => isDirty,
            save: () => { saveMcpServer(); },
            discard: () => { resetDirty(); },
            entityType: "this server",
          }
        : null
    );
    return () => registerUnsavedChangesGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

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
      enabled: mcpEnabledDraft,
      isVisionMcp: mcpIsVisionMcpDraft,
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
      setMcpIsVisionMcpDraft(savedServer.isVisionMcp);
      setMcpDraftTestResult(null);
      setIsAddingNew(false);
      setMobileDetailVisible(true);
    }

    toast.showToast("success", "MCP saved.");
    resetDirty({
      mcpName,
      mcpTransport,
      mcpUrl,
      mcpHeaders,
      mcpCommand,
      mcpArgs,
      mcpEnv,
      mcpEnabledDraft,
      mcpIsVisionMcpDraft,
    });
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

  function handleDeleteConfirm() {
    if (pendingDeleteId) {
      deleteMcpServer(pendingDeleteId);
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
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
    setMcpIsVisionMcpDraft(server.isVisionMcp);
    resetDirty({
      mcpName: server.name,
      mcpTransport: server.transport ?? "streamable_http",
      mcpUrl: server.url,
      mcpHeaders: JSON.stringify(server.headers, null, 2),
      mcpCommand: server.command ?? "",
      mcpArgs: server.args ? JSON.stringify(server.args) : "",
      mcpEnv: server.env ? JSON.stringify(server.env, null, 2) : "",
      mcpEnabledDraft: server.enabled,
      mcpIsVisionMcpDraft: server.isVisionMcp,
    });
  }

  function resetMcpForm() {
    const empty = {
      mcpName: "",
      mcpTransport: "streamable_http" as McpTransport,
      mcpUrl: "",
      mcpHeaders: "",
      mcpCommand: "",
      mcpArgs: "",
      mcpEnv: "",
      mcpEnabledDraft: true as boolean,
      mcpIsVisionMcpDraft: false as boolean,
    };
    setMcpTransport("streamable_http");
    setMcpName("");
    setMcpUrl("");
    setMcpHeaders("");
    setMcpCommand("");
    setMcpArgs("");
    setMcpEnv("");
    setMcpEnabledDraft(true);
    setMcpIsVisionMcpDraft(false);
    setEditingMcpId(null);
    setMcpDraftTestResult(null);
    setSelectedServerId(null);
    setIsAddingNew(false);
    resetDirty(empty);
  }

  function handleSelectServer(server: McpServer) {
    if (isDirty && selectedServerId !== server.id) {
      setPendingSwitch(() => () => {
        editMcpServer(server);
        setSelectedServerId(server.id);
        setIsAddingNew(false);
        setMobileDetailVisible(true);
      });
      setUnsavedDialogOpen(true);
      return;
    }
    editMcpServer(server);
    setSelectedServerId(server.id);
    setIsAddingNew(false);
    setMobileDetailVisible(true);
  }

  function handleAddNew() {
    if (isDirty) {
      setPendingSwitch(() => () => {
        resetMcpForm();
        setIsAddingNew(true);
        setSelectedServerId(null);
        setMobileDetailVisible(true);
      });
      setUnsavedDialogOpen(true);
      return;
    }
    resetMcpForm();
    setIsAddingNew(true);
    setSelectedServerId(null);
    setMobileDetailVisible(true);
  }

  function handleUnsavedSave() {
    setUnsavedDialogOpen(false);
    if (pendingSwitch) {
      saveMcpServer();
      pendingSwitch();
      setPendingSwitch(null);
    }
  }

  function handleUnsavedDiscard() {
    setUnsavedDialogOpen(false);
    if (pendingSwitch) {
      pendingSwitch();
      setPendingSwitch(null);
    }
  }

  const selectedServer = mcpServers.find((s) => s.id === selectedServerId);
  const showDetail = selectedServerId !== null || isAddingNew;


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
                    className={isFieldDirty("mcpName") ? "!border-amber-500/40" : ""}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>Transport</label>
                  <select
                    value={mcpTransport}
                    onChange={(e) => setMcpTransport(e.target.value as McpTransport)}
                    className={`${selectLike} ${isFieldDirty("mcpTransport") ? "!border-amber-500/40" : ""}`}
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
                        className={isFieldDirty("mcpUrl") ? "!border-amber-500/40" : ""}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Headers (JSON)</label>
                      <Textarea
                        value={mcpHeaders}
                        onChange={(e) => setMcpHeaders(e.target.value)}
                        placeholder='{"Authorization": "Bearer ..."}'
                        rows={2}
                        className={isFieldDirty("mcpHeaders") ? "!border-amber-500/40" : ""}
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
                        className={isFieldDirty("mcpCommand") ? "!border-amber-500/40" : ""}
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
                        className={isFieldDirty("mcpArgs") ? "!border-amber-500/40" : ""}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Environment variables (JSON, optional)</label>
                      <Textarea
                        value={mcpEnv}
                        onChange={(e) => setMcpEnv(e.target.value)}
                        placeholder='{"API_KEY": "..."}'
                        rows={2}
                        className={isFieldDirty("mcpEnv") ? "!border-amber-500/40" : ""}
                      />
                    </div>
                  </>
                )}
              </div>

              {editingMcpId ? (
                <div className="flex items-center gap-2">
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--text)] transition-colors ${isFieldDirty("mcpEnabledDraft") ? "border-amber-500/40" : "border-white/6"}`}>
                    <input
                      type="checkbox"
                      checked={mcpEnabledDraft}
                      onChange={(e) => setMcpEnabledDraft(e.target.checked)}
                    />
                    Enabled
                  </label>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--text)] transition-colors ${isFieldDirty("mcpIsVisionMcpDraft") ? "border-amber-500/40" : "border-white/6"}`}>
                    <input
                      type="checkbox"
                      checked={mcpIsVisionMcpDraft}
                      onChange={(e) => setMcpIsVisionMcpDraft(e.target.checked)}
                    />
                    Vision MCP
                  </label>
                </div>
              ) : null}
              </div>

              <div className={`${sectionDivider} py-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {isDirty && (
                    <span className="flex items-center gap-1 text-xs text-amber-400/80">
                      <span className="text-[0.5rem]">●</span> Unsaved changes
                    </span>
                  )}
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
                    onClick={() => {
                      setPendingDeleteId(editingMcpId);
                      setDeleteConfirmOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/80 transition-colors hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
              </div>

              <ConfirmDialog
                open={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title="Delete MCP server?"
                description={
                  <>
                    <strong className="text-[var(--text)] font-medium">{selectedServer?.name || "This server"}</strong> will be permanently deleted. This action cannot be undone.
                  </>
                }
                onConfirm={handleDeleteConfirm}
              />

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
              <UnsavedChangesDialog
                open={unsavedDialogOpen}
                onOpenChange={setUnsavedDialogOpen}
                entityType="this server"
                onSave={handleUnsavedSave}
                onDiscard={handleUnsavedDiscard}
              />
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
