import { z } from "zod";

import { requireAdminUser } from "@/lib/auth";
import { createMcpServer, getMcpServerBySlug, listMcpServers, slugify } from "@/lib/mcp-servers";
import { badRequest, forbidden, ok } from "@/lib/http";

export async function GET() {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }
  return ok({ servers: listMcpServers() });
}

const createSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("streamable_http"),
    name: z.string().trim().min(1).max(100),
    url: z.string().url(),
    headers: z.record(z.string()).optional()
  }),
  z.object({
    transport: z.literal("stdio"),
    name: z.string().trim().min(1).max(100),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional()
  })
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

  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid server config");

  const slug = slugify(body.data.name);
  const existing = getMcpServerBySlug(slug);
  if (existing) {
    return badRequest("An MCP server with a similar name already exists.");
  }

  return ok({ server: createMcpServer(body.data) }, { status: 201 });
}
