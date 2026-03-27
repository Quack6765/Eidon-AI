import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { McpServer } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function rowToMcpServer(row: {
  id: string;
  name: string;
  url: string;
  headers: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}): McpServer {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headers: JSON.parse(row.headers) as Record<string, string>,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listMcpServers() {
  const rows = getDb()
    .prepare(
      `SELECT id, name, url, headers, enabled, created_at, updated_at
       FROM mcp_servers
       ORDER BY created_at ASC`
    )
    .all() as Array<{
    id: string;
    name: string;
    url: string;
    headers: string;
    enabled: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToMcpServer);
}

export function getMcpServer(serverId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, name, url, headers, enabled, created_at, updated_at
       FROM mcp_servers
       WHERE id = ?`
    )
    .get(serverId) as
    | {
        id: string;
        name: string;
        url: string;
        headers: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? rowToMcpServer(row) : null;
}

export function createMcpServer(input: { name: string; url: string; headers?: Record<string, string> }) {
  const timestamp = nowIso();
  const server = {
    id: createId("mcp"),
    name: input.name,
    url: input.url,
    headers: input.headers ?? {},
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, url, headers, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      server.id,
      server.name,
      server.url,
      JSON.stringify(server.headers),
      server.enabled ? 1 : 0,
      server.createdAt,
      server.updatedAt
    );

  return server;
}

export function updateMcpServer(
  serverId: string,
  input: { name?: string; url?: string; headers?: Record<string, string>; enabled?: boolean }
) {
  const current = getMcpServer(serverId);
  if (!current) return null;

  const timestamp = nowIso();
  const name = input.name ?? current.name;
  const url = input.url ?? current.url;
  const headers = input.headers ?? current.headers;
  const enabled = input.enabled ?? current.enabled;

  getDb()
    .prepare(
      `UPDATE mcp_servers
       SET name = ?, url = ?, headers = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(name, url, JSON.stringify(headers), enabled ? 1 : 0, timestamp, serverId);

  return getMcpServer(serverId);
}

export function deleteMcpServer(serverId: string) {
  getDb().prepare("DELETE FROM mcp_servers WHERE id = ?").run(serverId);
}

export function listEnabledMcpServers() {
  return listMcpServers().filter((server) => server.enabled);
}
