import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getAutomationRun } from "@/lib/automations";
import { getConversationSnapshot } from "@/lib/conversations";
import { notFoundResponse, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({ runId: z.string().min(1) });

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "automation run id");
  if (params instanceof NextResponse) return params;

  const run = getAutomationRun(params.runId, user.id);
  if (!run) return notFoundResponse("Automation run not found");

  const transcript = run.conversationId
    ? getConversationSnapshot(run.conversationId, user.id)
    : null;
  return ok({ run, transcript });
}
