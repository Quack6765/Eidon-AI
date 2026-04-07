import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteMcpServer, getMcpServer, updateMcpServer } from "@/lib/mcp-servers";
import { disconnectMcpServer, getConnectedClient } from "@/lib/mcp-client";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({ serverId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serverId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid server id");

  const body = await request.json() as {
    name?: string;
    url?: string;
    headers?: Record<string, string>;
    transport?: "streamable_http" | "stdio";
    command?: string | null;
    args?: string[] | null;
    env?: Record<string, string> | null;
    enabled?: boolean;
  };

  if (body.enabled === false) {
    const current = getMcpServer(params.data.serverId);
    if (current) {
      disconnectMcpServer(current).catch(() => {});
    }
  }

  const updated = updateMcpServer(params.data.serverId, body);
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
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid server id");

  const server = getMcpServer(params.data.serverId);
  if (server) {
    disconnectMcpServer(server).catch(() => {});
  }

  deleteMcpServer(params.data.serverId);
  return ok({ success: true });
}
