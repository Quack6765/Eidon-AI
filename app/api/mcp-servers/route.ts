import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createMcpServer, getMcpServerBySlug, listMcpServers, slugify } from "@/lib/mcp-servers";
import { badRequest, ok } from "@/lib/http";

export async function GET() {
  await requireUser();
  return ok({ servers: listMcpServers() });
}

const createSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("streamable_http"),
    name: z.string().min(1).max(100),
    url: z.string().url(),
    headers: z.record(z.string()).optional()
  }),
  z.object({
    transport: z.literal("stdio"),
    name: z.string().min(1).max(100),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional()
  })
]);

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid server config");

  const slug = slugify(body.data.name);
  const existing = getMcpServerBySlug(slug);
  if (existing) {
    return badRequest("An MCP server with a similar name already exists.");
  }

  return ok({ server: createMcpServer(body.data) }, { status: 201 });
}
