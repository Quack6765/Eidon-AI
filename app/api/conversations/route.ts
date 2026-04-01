import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  createConversation,
  DEFAULT_CONVERSATION_PAGE_SIZE,
  listConversationsPage,
  reorderConversations
} from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";
import { getProviderProfile } from "@/lib/settings";

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
  folderId: z.string().nullable().optional(),
  providerProfileId: z.string().min(1).optional(),
  toolExecutionMode: z.enum(["read_only", "read_write"]).optional()
});

export async function POST(request: Request) {
  await requireUser();
  let parsedBody: unknown = {};

  try {
    const rawBody = await request.text();
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsedBody = {};
  }

  const body = createSchema.safeParse(parsedBody);
  const title = body.success ? body.data.title : undefined;
  const folderId = body.success ? body.data.folderId : undefined;
  const providerProfileId = body.success ? body.data.providerProfileId : undefined;
  const toolExecutionMode = body.success ? body.data.toolExecutionMode : undefined;

  if (providerProfileId !== undefined && !getProviderProfile(providerProfileId)) {
    return badRequest("Provider profile not found", 404);
  }

  return ok(
    {
      conversation: createConversation(title, folderId, {
        providerProfileId,
        toolExecutionMode
      })
    },
    { status: 201 }
  );
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
