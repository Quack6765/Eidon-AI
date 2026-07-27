import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { testMcpServerConnection } from "@/lib/mcp-client";
import { getMcpServer } from "@/lib/mcp-servers";

const draftSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("streamable_http"),
    name: z.string().min(1).max(100),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    headersAction: z.enum(["preserve", "replace", "clear"]).optional()
  }),
  z.object({
    transport: z.literal("stdio"),
    name: z.string().min(1).max(100),
    command: z.string().min(1),
    args: z.array(z.string()).nullable().optional(),
    env: z.record(z.string()).nullable().optional(),
    envAction: z.enum(["preserve", "replace", "clear"]).optional(),
    url: z.string().optional().default(""),
    headers: z.record(z.string()).optional(),
    headersAction: z.enum(["preserve", "replace", "clear"]).optional()
  })
]);

const bodySchema = z.union([
  z.object({
    serverId: z.string().min(1),
    draft: draftSchema
  }),
  z.object({
    serverId: z.string().min(1)
  }),
  draftSchema
]);

export async function POST(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  const body = bodySchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid MCP test payload");
  }

  const storedServer = "serverId" in body.data ? getMcpServer(body.data.serverId) : null;
  const draft = "draft" in body.data ? body.data.draft : "serverId" in body.data ? null : body.data;
  const server = draft
      ? {
          id: "draft",
          name: draft.name,
          url: draft.transport === "streamable_http" ? draft.url : draft.url ?? "",
          headers: draft.headersAction === "preserve"
            ? storedServer?.headers ?? {}
            : draft.headersAction === "clear"
              ? {}
              : draft.headers ?? {},
          transport: draft.transport,
          command: draft.transport === "stdio" ? draft.command : null,
          args: draft.transport === "stdio" ? draft.args ?? null : null,
          env: draft.transport === "stdio"
            ? draft.envAction === "preserve"
              ? storedServer?.env ?? null
              : draft.envAction === "clear"
                ? null
                : draft.env ?? null
            : null,
          enabled: true,
          createdAt: "",
          updatedAt: ""
        }
      : storedServer;

  if (!server) {
    return badRequest("MCP server not found", 404);
  }

  try {
    const result = await testMcpServerConnection(server);

    return ok({
      success: true,
      protocolVersion: result.protocolVersion,
      serverInfo: result.serverInfo,
      sessionId: result.sessionId,
      toolCount: result.toolCount,
      text: `${result.toolCount} tool${result.toolCount === 1 ? "" : "s"} discovered`,
      stderr: result.stderr
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP connection test failed";
    return badRequest(message, 502);
  }
}
