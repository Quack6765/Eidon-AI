import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { dismissMemoryProposal } from "@/lib/memory-proposals";
import { dismissAutomationProposal } from "@/lib/automation-proposals";
import { dismissToolApproval } from "@/lib/tool-approvals";
import { discardMessageDraft } from "@/lib/message-drafts";
import { declineComputerSecret } from "@/lib/computer-secrets";
import { getMessageActionKind } from "@/lib/conversations";

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
    if (getMessageActionKind(params.actionId) === "create_automation") {
      const action = dismissAutomationProposal(params.actionId, user.id);
      return ok({ action });
    }

    if (getMessageActionKind(params.actionId) === "tool_approval") {
      const action = dismissToolApproval(params.actionId, user.id);
      return ok({ action });
    }

    if (getMessageActionKind(params.actionId) === "draft_message") {
      const action = discardMessageDraft(params.actionId, user.id);
      return ok({ action });
    }

    if (getMessageActionKind(params.actionId) === "secret_request") {
      const action = declineComputerSecret(params.actionId, user.id);
      return ok({ action });
    }

    const action = dismissMemoryProposal(params.actionId, user.id);
    return ok({ action });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to dismiss proposal");
  }
}
