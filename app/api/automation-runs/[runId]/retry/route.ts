import { NextResponse } from "next/server";
import { z } from "zod";

import { retryAutomationRunNow } from "@/lib/automation-scheduler";
import { requireUser } from "@/lib/auth";
import { getAutomationRun } from "@/lib/automations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  runId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "automation run id");
  if (params instanceof NextResponse) return params;

  const existingRun = getAutomationRun(params.runId, user.id);
  if (!existingRun) {
    return badRequest("Automation run not found", 404);
  }

  if (existingRun.status !== "failed") {
    return badRequest("Only failed automation runs can be retried");
  }

  const run = await retryAutomationRunNow(params.runId, user.id);

  if (!run) {
    return badRequest("Automation run not found", 404);
  }

  return ok({ run }, { status: 201 });
}
