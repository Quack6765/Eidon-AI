import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteMcpServer, getMcpServer, updateMcpServer } from "@/lib/mcp-servers";
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
    enabled?: boolean;
  };

  const updated = updateMcpServer(params.data.serverId, body);
  if (!updated) return badRequest("Server not found", 404);

  return ok({ server: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ serverId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid server id");

  deleteMcpServer(params.data.serverId);
  return ok({ success: true });
}
