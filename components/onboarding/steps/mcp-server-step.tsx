"use client";

import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import type { McpTransport } from "@/lib/types";

export type McpDraft = {
  name: string;
  transport: McpTransport;
  url: string;
  command: string;
  args: string;
  /** Raw JSON object text, same as the settings editor. */
  headers: string;
  env: string;
};

export type McpTestResult =
  | { state: "success" | "error" | "auth-required"; message: string }
  | null;

/** The JSON payload field that applies to the draft's transport, if any. */
function activeJsonField(draft: McpDraft) {
  return draft.transport === "streamable_http"
    ? { value: draft.headers, label: "Headers" }
    : { value: draft.env, label: "Environment variables" };
}

/**
 * Parses a JSON payload field into the string map the API expects. Returns
 * `null` when the text is present but not a valid JSON object — the settings
 * editor silently discards that, which loses a user's typed secrets.
 */
export function parseJsonRecord(text: string): Record<string, string> | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
  );
}

export function getMcpJsonError(draft: McpDraft) {
  const field = activeJsonField(draft);
  return parseJsonRecord(field.value) === null
    ? `${field.label} must be a JSON object, for example {"KEY": "value"}.`
    : null;
}

/** Args accept a JSON array or a plain space-separated string, as in settings. */
function parseArgs(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Fall through to whitespace splitting.
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

/**
 * The request body for both `POST /api/mcp-servers` and the bare-draft form of
 * `POST /api/mcp-servers/test`, so a tested draft is exactly what gets saved.
 * Create takes `headers`/`env` directly — the action tri-state is PATCH-only.
 */
export function buildMcpServerPayload(draft: McpDraft) {
  if (draft.transport === "streamable_http") {
    const headers = parseJsonRecord(draft.headers);
    return {
      transport: "streamable_http" as const,
      name: draft.name.trim(),
      url: draft.url.trim(),
      ...(headers ? { headers } : {})
    };
  }
  const args = parseArgs(draft.args);
  const env = parseJsonRecord(draft.env);
  return {
    transport: "stdio" as const,
    name: draft.name.trim(),
    command: draft.command.trim(),
    ...(args ? { args } : {}),
    ...(env ? { env } : {})
  };
}

export function mcpDraftIsComplete(draft: McpDraft) {
  if (!draft.name.trim()) return false;
  if (getMcpJsonError(draft)) return false;
  return draft.transport === "streamable_http"
    ? Boolean(draft.url.trim())
    : Boolean(draft.command.trim());
}

export function McpServerStep({
  draft,
  onChange,
  testResult,
  isTesting,
  onTest
}: {
  draft: McpDraft;
  onChange: (draft: McpDraft) => void;
  testResult: McpTestResult;
  isTesting: boolean;
  onTest: () => void;
}) {
  const jsonError = getMcpJsonError(draft);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={fieldLabel} htmlFor="onboarding-mcp-name">
          Name
        </label>
        <Input
          id="onboarding-mcp-name"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="My MCP Server"
        />
      </div>

      <div>
        <label className={fieldLabel} htmlFor="onboarding-mcp-transport">
          Transport
        </label>
        <select
          id="onboarding-mcp-transport"
          value={draft.transport}
          onChange={(event) =>
            onChange({ ...draft, transport: event.target.value as McpTransport })
          }
          className={selectLike}
        >
          <option value="streamable_http">Streamable HTTP</option>
          <option value="stdio">Local stdio</option>
        </select>
      </div>

      {draft.transport === "streamable_http" ? (
        <div>
          <label className={fieldLabel} htmlFor="onboarding-mcp-url">
            URL
          </label>
          <Input
            id="onboarding-mcp-url"
            value={draft.url}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
            placeholder="https://..."
          />
          <div className="mt-4">
            <label className={fieldLabel} htmlFor="onboarding-mcp-headers">
              Headers (JSON)
            </label>
            <Textarea
              id="onboarding-mcp-headers"
              value={draft.headers}
              onChange={(event) => onChange({ ...draft, headers: event.target.value })}
              placeholder={'{"Authorization": "Bearer ..."}'}
              rows={2}
            />
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Optional. Stored encrypted — use this for bearer tokens or any header the server
              requires.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className={fieldLabel} htmlFor="onboarding-mcp-command">
              Command
            </label>
            <Input
              id="onboarding-mcp-command"
              value={draft.command}
              onChange={(event) => onChange({ ...draft, command: event.target.value })}
              placeholder="uvx or npx"
            />
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Use &quot;uvx&quot; for Python-based servers or &quot;npx&quot; for Node.js-based
              servers.
            </p>
          </div>
          <div>
            <label className={fieldLabel} htmlFor="onboarding-mcp-args">
              Args (JSON array or space-separated)
            </label>
            <Input
              id="onboarding-mcp-args"
              value={draft.args}
              onChange={(event) => onChange({ ...draft, args: event.target.value })}
              placeholder={
                draft.command === "npx" ? "-y @modelcontextprotocol/server-fetch" : "mcp-server-fetch"
              }
            />
          </div>
          <div>
            <label className={fieldLabel} htmlFor="onboarding-mcp-env">
              Environment variables (JSON, optional)
            </label>
            <Textarea
              id="onboarding-mcp-env"
              value={draft.env}
              onChange={(event) => onChange({ ...draft, env: event.target.value })}
              placeholder={'{"API_KEY": "..."}'}
              rows={2}
            />
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Stored encrypted. Use this for any key the server process needs.
            </p>
          </div>
        </>
      )}

      {jsonError ? (
        <p role="alert" className="flex items-start gap-2 text-xs leading-5 text-red-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {jsonError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4">
        <button
          type="button"
          onClick={onTest}
          disabled={!mcpDraftIsComplete(draft) || isTesting}
          className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-4 text-[13px] text-[var(--text)] transition hover:bg-white/[0.06] disabled:opacity-40"
        >
          {isTesting ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          Test connection
        </button>
        {testResult ? (
          <p
            role="status"
            className={`flex items-start gap-2 text-xs leading-5 ${
              testResult.state === "success"
                ? "text-emerald-300"
                : testResult.state === "auth-required"
                  ? "text-amber-300"
                  : "text-red-300"
            }`}
          >
            {testResult.state === "success" ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : testResult.state === "auth-required" ? (
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            {testResult.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
