import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { testMcpServerConnection } from "@/lib/mcp-client";
import {
  checkMcpOAuthSupport,
  getMcpOAuthConnectionSummary,
  markMcpOAuthConnectionAuthRequired,
  markMcpOAuthConnectionConnected,
  McpAuthenticationRequiredError,
  MCP_AUTH_REQUIRED_MESSAGE
} from "@/lib/mcp-oauth";
import { getMcpServer } from "@/lib/mcp-servers";

const bodySchema = z.strictObject({ serverId: z.string().min(1) });

export async function POST(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return badRequest("Invalid MCP test payload");
  }

  const server = getMcpServer(body.data.serverId);
  if (!server) {
    return badRequest("MCP server not found", 404);
  }

  try {
    const result = await testMcpServerConnection(server);
    markMcpOAuthConnectionConnected(server.id);

    return ok({
      success: true,
      protocolVersion: result.protocolVersion,
      serverInfo: result.serverInfo,
      sessionId: result.sessionId,
      toolCount: result.toolCount,
      text: `${result.toolCount} tool${result.toolCount === 1 ? "" : "s"} discovered`,
      oauth: getMcpOAuthConnectionSummary(server.id)
    });
  } catch (error) {
    console.error(`[mcp-servers/test] ${server.id} failed:`, error);

    if (
      error instanceof McpAuthenticationRequiredError &&
      server.transport === "streamable_http" &&
      (await checkMcpOAuthSupport(server.url))
    ) {
      markMcpOAuthConnectionAuthRequired(server.id, { createIfMissing: true });
      return ok({
        success: false,
        requiresAuth: true,
        text: "Authentication required",
        oauth: getMcpOAuthConnectionSummary(server.id)
      });
    }

    const detail =
      error instanceof McpAuthenticationRequiredError
        ? MCP_AUTH_REQUIRED_MESSAGE
        : "Could not reach the server.";
    return badRequest("MCP connection test failed", 502, detail);
  }
}
