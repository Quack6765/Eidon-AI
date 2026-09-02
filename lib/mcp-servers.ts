import { getDb } from "@/lib/db";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { evictMcpClientsByServerId } from "@/lib/mcp-client";
import { deleteMcpOAuthConnection, listMcpOAuthConnectionSummaries } from "@/lib/mcp-oauth";
import { createId } from "@/lib/ids";
import type { McpServer, McpServerSummary, McpTransport } from "@/lib/types";
import { nowIso } from "@/lib/utils";


export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

type McpServerRow = {
  id: string;
  name: string;
  slug: string;
  url: string;
  headers: string;
  transport: string;
  command: string | null;
  args: string | null;
  env: string | null;
  enabled: number;
  is_vision_mcp: number;
  created_at: string;
  updated_at: string;
};

function rowToMcpServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    headers: parseSecretRecord(row.headers, {}),
    transport: (row.transport ?? "streamable_http") as McpTransport,
    command: row.command,
    args: row.args ? (JSON.parse(row.args) as string[]) : null,
    env: row.env ? parseSecretRecord(row.env, null) : null,
    enabled: Boolean(row.enabled),
    isVisionMcp: Boolean(row.is_vision_mcp),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseSecretRecord<T extends Record<string, string> | null>(
  value: string,
  fallback: T
): Record<string, string> | T {
  try {
    return JSON.parse(decryptValue(value)) as Record<string, string>;
  } catch {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return fallback;
    }
  }
}

function encryptSecretRecord(value: Record<string, string> | null) {
  return value === null ? null : encryptValue(JSON.stringify(value));
}

export function sanitizeMcpServer(
  server: McpServer,
  oauth: McpServerSummary["oauth"] = null
): McpServerSummary {
  return {
    ...server,
    headers: {},
    env: null,
    hasHeaders: Object.keys(server.headers).length > 0,
    hasEnv: Boolean(server.env && Object.keys(server.env).length > 0),
    oauth
  };
}

export function listSanitizedMcpServers() {
  const oauthSummaries = listMcpOAuthConnectionSummaries();
  return listMcpServers().map((server) =>
    sanitizeMcpServer(server, oauthSummaries[server.id] ?? null)
  );
}

const SELECT_COLUMNS = `id, name, slug, url, headers, transport, command, args, env, enabled, is_vision_mcp, created_at, updated_at`;

export function listMcpServers() {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM mcp_servers
       ORDER BY created_at ASC`
    )
    .all() as Array<McpServerRow>;

  return rows.map(rowToMcpServer);
}

export function getMcpServer(serverId: string) {
  const row = getMcpServerRow(serverId);

  return row ? rowToMcpServer(row) : null;
}

function getMcpServerRow(serverId: string) {
  return getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM mcp_servers
       WHERE id = ?`
    )
    .get(serverId) as McpServerRow | undefined;
}

export function getMcpServerBySlug(slug: string) {
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM mcp_servers
       WHERE slug = ?`
    )
    .get(slug) as McpServerRow | undefined;

  return row ? rowToMcpServer(row) : null;
}

type CreateMcpServerInput = {
  name: string;
  url?: string;
  headers?: Record<string, string>;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  isVisionMcp?: boolean;
};

export function createMcpServer(input: CreateMcpServerInput) {
  const timestamp = nowIso();
  const transport = input.transport ?? "streamable_http";
  const name = input.name.trim();
  const server: McpServer = {
    id: createId("mcp"),
    name,
    slug: slugify(name) || "unnamed",
    url: input.url ?? "",
    headers: input.headers ?? {},
    transport,
    command: input.command ?? null,
    args: input.args ?? null,
    env: input.env ?? null,
    enabled: input.enabled ?? true,
    isVisionMcp: input.isVisionMcp ?? false,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, slug, url, headers, transport, command, args, env, enabled, is_vision_mcp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      server.id,
      server.name,
      server.slug,
      server.url,
      encryptSecretRecord(server.headers),
      server.transport,
      server.command,
      server.args ? JSON.stringify(server.args) : null,
      encryptSecretRecord(server.env),
      server.enabled ? 1 : 0,
      server.isVisionMcp ? 1 : 0,
      server.createdAt,
      server.updatedAt
    );

  return server;
}

type UpdateMcpServerInput = {
  name?: string;
  url?: string;
  headers?: Record<string, string>;
  transport?: McpTransport;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  headersAction?: "preserve" | "replace" | "clear";
  envAction?: "preserve" | "replace" | "clear";
  enabled?: boolean;
  isVisionMcp?: boolean;
};

export function updateMcpServer(
  serverId: string,
  input: UpdateMcpServerInput
) {
  const currentRow = getMcpServerRow(serverId);
  if (!currentRow) return null;
  const current = rowToMcpServer(currentRow);

  const timestamp = nowIso();
  const name = input.name !== undefined ? input.name.trim() : current.name;
  const slug = input.name !== undefined ? (slugify(name) || "unnamed") : current.slug;
  const url = input.url ?? current.url;
  const transport = input.transport ?? current.transport;
  const headersAction = input.headersAction ??
    (input.headers !== undefined
      ? Object.keys(input.headers).length
        ? "replace"
        : "clear"
      : "preserve");
  const envAction = input.envAction ??
    (input.env !== undefined
      ? input.env && Object.keys(input.env).length
        ? "replace"
        : "clear"
      : "preserve");
  const headersEncrypted = headersAction === "preserve"
    ? currentRow.headers
    : headersAction === "replace"
      ? encryptSecretRecord(input.headers ?? {})
      : encryptSecretRecord({});
  const command = input.command !== undefined ? input.command : current.command;
  const args = input.args !== undefined ? input.args : current.args;
  const envEncrypted = envAction === "preserve"
    ? currentRow.env
    : envAction === "replace"
      ? encryptSecretRecord(input.env ?? null)
      : null;
  const enabled = input.enabled ?? current.enabled;
  const isVisionMcp = input.isVisionMcp ?? current.isVisionMcp;

  if (url !== current.url || transport !== current.transport) {
    deleteMcpOAuthConnection(serverId);
    evictMcpClientsByServerId(serverId);
  }

  getDb()
    .prepare(
      `UPDATE mcp_servers
       SET name = ?, slug = ?, url = ?, headers = ?, transport = ?, command = ?, args = ?, env = ?, enabled = ?, is_vision_mcp = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      name,
      slug,
      url,
      headersEncrypted,
      transport,
      command,
      args ? JSON.stringify(args) : null,
      envEncrypted,
      enabled ? 1 : 0,
      isVisionMcp ? 1 : 0,
      timestamp,
      serverId
    );

  return getMcpServer(serverId);
}

export function deleteMcpServer(serverId: string) {
  getDb().prepare("DELETE FROM mcp_servers WHERE id = ?").run(serverId);
}

export function listEnabledMcpServers() {
  return listMcpServers().filter((server) => server.enabled);
}
