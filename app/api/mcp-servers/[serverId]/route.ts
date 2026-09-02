import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { getMcpOAuthConnectionSummary } from "@/lib/mcp-oauth";
import {
  deleteMcpServer,
  getMcpServer,
  getMcpServerBySlug,
  sanitizeMcpServer,
  updateMcpServer,
  slugify
} from "@/lib/mcp-servers";
import { disconnectMcpServer, getConnectedClient } from "@/lib/mcp-client";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({ serverId: z.string().min(1) });
const secretActionSchema = z.enum(["preserve", "replace", "clear"]);
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  headersAction: secretActionSchema.optional(),
  transport: z.enum(["streamable_http", "stdio"]).optional(),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  env: z.record(z.string()).nullable().optional(),
  envAction: secretActionSchema.optional(),
  enabled: z.boolean().optional(),
  isVisionMcp: z.boolean().optional()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serverId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

    const params = await parseRouteParams(context, paramsSchema, "server id");
  if (params instanceof NextResponse) return params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid server config");
  const body = parsed.data;

  if (body.name !== undefined) {
    const trimmedName = body.name.trim();
    if (!trimmedName) {
      return badRequest("Server name cannot be empty.");
    }
    body.name = trimmedName;
    const slug = slugify(trimmedName);
    const conflicting = getMcpServerBySlug(slug);
    if (conflicting && conflicting.id !== params.serverId) {
      return badRequest("An MCP server with a similar name already exists.");
    }
  }

  if (body.enabled === false) {
    const current = getMcpServer(params.serverId);
    if (current) {
      disconnectMcpServer(current).catch(() => {});
    }
  }

  const updated = updateMcpServer(params.serverId, body);
  if (!updated) return badRequest("Server not found", 404);

  if (updated.enabled && body.enabled === true) {
    getConnectedClient(updated).catch(() => {});
  }

  return ok({ server: sanitizeMcpServer(updated, getMcpOAuthConnectionSummary(updated.id)) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ serverId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

    const params = await parseRouteParams(context, paramsSchema, "server id");
  if (params instanceof NextResponse) return params;

  const server = getMcpServer(params.serverId);
  if (server) {
    disconnectMcpServer(server).catch(() => {});
  }

  deleteMcpServer(params.serverId);
  return ok({ success: true });
}
