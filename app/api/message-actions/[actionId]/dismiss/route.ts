import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { dismissMemoryProposal } from "@/lib/memory-proposals";

const paramsSchema = z.object({
  actionId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "action id");
  if (params instanceof NextResponse) return params;

  try {
    const action = dismissMemoryProposal(params.actionId, user.id);
    return ok({ action });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to dismiss memory proposal");
  }
}
