import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { revokeToolApprovalRule } from "@/lib/tool-approvals";

const paramsSchema = z.object({ ruleId: z.string().min(1) });

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ ruleId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "rule id");
  if (params instanceof NextResponse) return params;

  const revoked = revokeToolApprovalRule(params.ruleId, user.id);
  if (!revoked) return badRequest("Tool approval rule not found", 404);

  return ok({ success: true });
}
