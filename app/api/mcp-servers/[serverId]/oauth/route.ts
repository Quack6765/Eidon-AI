import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";
import { evictMcpClientsByServerId } from "@/lib/mcp-client";
import { deleteMcpOAuthConnection } from "@/lib/mcp-oauth";
import { getMcpServer } from "@/lib/mcp-servers";

const paramsSchema = z.object({ serverId: z.string().min(1) });

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ serverId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  const params = await parseRouteParams(context, paramsSchema, "server id");
  if (params instanceof NextResponse) return params;

  const server = getMcpServer(params.serverId);
  if (!server) return badRequest("MCP server not found", 404);

  deleteMcpOAuthConnection(params.serverId);
  evictMcpClientsByServerId(params.serverId);
  return ok({ success: true });
}
