import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { McpServer, McpTransport } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

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
  created_at: string;
  updated_at: string;
};

function rowToMcpServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    headers: JSON.parse(row.headers) as Record<string, string>,
    transport: (row.transport ?? "streamable_http") as McpTransport,
    command: row.command,
    args: row.args ? (JSON.parse(row.args) as string[]) : null,
    env: row.env ? (JSON.parse(row.env) as Record<string, string>) : null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SELECT_COLUMNS = `id, name, slug, url, headers, transport, command, args, env, enabled, created_at, updated_at`;

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
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM mcp_servers
       WHERE id = ?`
    )
    .get(serverId) as McpServerRow | undefined;

  return row ? rowToMcpServer(row) : null;
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
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, slug, url, headers, transport, command, args, env, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      server.id,
      server.name,
      server.slug,
      server.url,
      JSON.stringify(server.headers),
      server.transport,
      server.command,
      server.args ? JSON.stringify(server.args) : null,
      server.env ? JSON.stringify(server.env) : null,
      server.enabled ? 1 : 0,
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
  enabled?: boolean;
};

export function updateMcpServer(
  serverId: string,
  input: UpdateMcpServerInput
) {
  const current = getMcpServer(serverId);
  if (!current) return null;

  const timestamp = nowIso();
  const name = input.name !== undefined ? input.name.trim() : current.name;
  const slug = input.name !== undefined ? (slugify(name) || "unnamed") : current.slug;
  const url = input.url ?? current.url;
  const headers = input.headers ?? current.headers;
  const transport = input.transport ?? current.transport;
  const command = input.command !== undefined ? input.command : current.command;
  const args = input.args !== undefined ? input.args : current.args;
  const env = input.env !== undefined ? input.env : current.env;
  const enabled = input.enabled ?? current.enabled;

  getDb()
    .prepare(
      `UPDATE mcp_servers
       SET name = ?, slug = ?, url = ?, headers = ?, transport = ?, command = ?, args = ?, env = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      name,
      slug,
      url,
      JSON.stringify(headers),
      transport,
      command,
      args ? JSON.stringify(args) : null,
      env ? JSON.stringify(env) : null,
      enabled ? 1 : 0,
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
