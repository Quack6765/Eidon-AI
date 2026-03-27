import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createMcpServer, listMcpServers } from "@/lib/mcp-servers";
import { badRequest, ok } from "@/lib/http";

export async function GET() {
  await requireUser();
  return ok({ servers: listMcpServers() });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  headers: z.record(z.string()).optional()
});

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid server config");

  return ok({ server: createMcpServer(body.data) }, { status: 201 });
}
