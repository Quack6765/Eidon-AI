import { completeMcpOAuthCallback } from "@/lib/mcp-oauth";
import { evictMcpClientsByServerId } from "@/lib/mcp-client";
import { getRequestOrigin } from "@/lib/request-url";

export async function GET(request: Request) {
  const result = await completeMcpOAuthCallback(request);

  if (result.status === "invalid_state") {
    return new Response("Invalid or expired OAuth state", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  if (result.status === "success" && result.serverId) {
    evictMcpClientsByServerId(result.serverId);
  }

  const destination = new URL("/settings/mcp-servers", getRequestOrigin(request));
  destination.searchParams.set("connection", result.status);
  if (result.serverId) {
    destination.searchParams.set("server", result.serverId);
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: destination.toString(),
      "cache-control": "no-store"
    }
  });
}
