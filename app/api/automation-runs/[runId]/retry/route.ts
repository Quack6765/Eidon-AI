import { z } from "zod";

import { retryAutomationRunNow } from "@/lib/automation-scheduler";
import { requireUser } from "@/lib/auth";
import { getAutomationRun } from "@/lib/automations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  runId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid automation run id");
  }

  const existingRun = getAutomationRun(params.data.runId, user.id);
  if (!existingRun) {
    return badRequest("Automation run not found", 404);
  }

  if (existingRun.status !== "failed") {
    return badRequest("Only failed automation runs can be retried");
  }

  const run = await retryAutomationRunNow(params.data.runId, user.id);

  if (!run) {
    return badRequest("Automation run not found", 404);
  }

  return ok({ run }, { status: 201 });
}
