import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createConversation, listConversations, reorderConversations } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

export async function GET() {
  await requireUser();
  return ok({ conversations: listConversations() });
}

const createSchema = z.object({
  title: z.string().optional(),
  folderId: z.string().nullable().optional()
});

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  const title = body.success ? body.data.title : undefined;
  const folderId = body.success ? body.data.folderId : undefined;
  return ok({ conversation: createConversation(title, folderId) }, { status: 201 });
}

export async function PUT(request: Request) {
  await requireUser();
  const body = await request.json() as Array<{ id: string; folderId: string | null }>;
  if (!Array.isArray(body)) {
    return badRequest("Invalid reorder payload");
  }
  reorderConversations(body);
  return ok({ success: true });
}
