import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok, parseRouteParams } from "@/lib/http";
import { startMcpOAuthFlow } from "@/lib/mcp-oauth";
import { getMcpServer } from "@/lib/mcp-servers";
import { getMcpOAuthCallbackUrl, getRequestOrigin } from "@/lib/request-url";

const paramsSchema = z.object({ serverId: z.string().min(1) });

export async function POST(
  request: Request,
  context: { params: Promise<{ serverId: string }> }
) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  const params = await parseRouteParams(context, paramsSchema, "server id");
  if (params instanceof NextResponse) return params;

  const server = getMcpServer(params.serverId);
  if (!server) return badRequest("MCP server not found", 404);
  if (server.transport !== "streamable_http") {
    return badRequest("OAuth is only supported for Streamable HTTP MCP servers");
  }

  try {
    const origin = getRequestOrigin(request);
    const flow = await startMcpOAuthFlow({
      serverId: server.id,
      serverUrl: server.url,
      userId: admin.id,
      redirectUri: getMcpOAuthCallbackUrl(request),
      clientUri: origin,
      logoUri: `${origin}/agent-icon.png`
    });
    return ok(flow, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start MCP OAuth flow";
    return badRequest(message, 502);
  }
}
