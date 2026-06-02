import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { deleteMcpServer, getMcpServer, getMcpServerBySlug, updateMcpServer, slugify } from "@/lib/mcp-servers";
import { disconnectMcpServer, getConnectedClient } from "@/lib/mcp-client";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({ serverId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serverId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

    const params = await parseRouteParams(context, paramsSchema, "server id");
  if (params instanceof NextResponse) return params;

  const body = await request.json() as {
    name?: string;
    url?: string;
    headers?: Record<string, string>;
    transport?: "streamable_http" | "stdio";
    command?: string | null;
    args?: string[] | null;
    env?: Record<string, string> | null;
    enabled?: boolean;
    isVisionMcp?: boolean;
  };

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

  return ok({ server: updated });
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
