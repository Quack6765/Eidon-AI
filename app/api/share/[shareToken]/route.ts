import { z } from "zod";

import { getSharedConversationSnapshot } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  shareToken: z.string().min(16)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ shareToken: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Shared conversation not found", 404);
  }

  const snapshot = getSharedConversationSnapshot(params.data.shareToken);

  if (!snapshot) {
    return badRequest("Shared conversation not found", 404);
  }

  return ok(snapshot);
}
