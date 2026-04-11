import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { approveMemoryProposal } from "@/lib/memory-proposals";

const paramsSchema = z.object({
  actionId: z.string().min(1)
});

const bodySchema = z.object({
  content: z.string().trim().min(1).max(1000).optional(),
  category: z.enum(["personal", "preference", "work", "location", "other"]).optional()
});

async function parseApprovalBody(request: Request) {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("Invalid approval overrides");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid action id");

  let rawBody: unknown;
  try {
    rawBody = await parseApprovalBody(request);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid approval overrides");
  }

  const body = bodySchema.safeParse(rawBody);
  if (!body.success) return badRequest("Invalid approval overrides");

  try {
    const action = approveMemoryProposal(params.data.actionId, body.data, user.id);
    return ok({ action });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to approve memory proposal");
  }
}
