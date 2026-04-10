import { z } from "zod";

import { requireAdminUser } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { testMcpServerConnection } from "@/lib/mcp-client";
import { getMcpServer } from "@/lib/mcp-servers";

const draftSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("streamable_http"),
    name: z.string().min(1).max(100),
    url: z.string().url(),
    headers: z.record(z.string()).default({})
  }),
  z.object({
    transport: z.literal("stdio"),
    name: z.string().min(1).max(100),
    command: z.string().min(1),
    args: z.array(z.string()).nullable().optional(),
    env: z.record(z.string()).nullable().optional(),
    url: z.string().optional().default(""),
    headers: z.record(z.string()).default({})
  })
]);

const bodySchema = z.union([
  z.object({
    serverId: z.string().min(1)
  }),
  draftSchema
]);

export async function POST(request: Request) {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  const body = bodySchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid MCP test payload");
  }

  const server =
    "serverId" in body.data
      ? getMcpServer(body.data.serverId)
      : {
          id: "draft",
          name: body.data.name,
          url: body.data.transport === "streamable_http" ? body.data.url : body.data.url ?? "",
          headers: body.data.headers ?? {},
          transport: body.data.transport,
          command: body.data.transport === "stdio" ? body.data.command : null,
          args: body.data.transport === "stdio" ? body.data.args ?? null : null,
          env: body.data.transport === "stdio" ? body.data.env ?? null : null,
          enabled: true,
          createdAt: "",
          updatedAt: ""
        };

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
