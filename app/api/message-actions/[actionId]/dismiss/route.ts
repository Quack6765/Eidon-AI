import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { dismissMemoryProposal } from "@/lib/memory-proposals";

const paramsSchema = z.object({
  actionId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid action id");

  try {
    const action = dismissMemoryProposal(params.data.actionId, user.id);
    return ok({ action });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to dismiss memory proposal");
  }
}
