import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  createConversation,
  DEFAULT_CONVERSATION_PAGE_SIZE,
  listConversationsPage,
  reorderConversations
} from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const listSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(DEFAULT_CONVERSATION_PAGE_SIZE)
});

export async function GET(request: Request) {
  await requireUser();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const query = listSchema.safeParse(params);

  if (!query.success) {
    return badRequest("Invalid conversation list params");
  }

  try {
    return ok(listConversationsPage(query.data));
  } catch {
    return badRequest("Invalid conversation list cursor");
  }
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
