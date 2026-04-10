import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { retryAutomationRun } from "@/lib/automations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  runId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid automation run id");
  }

  const run = retryAutomationRun(params.data.runId);

  if (!run) {
    return badRequest("Automation run not found", 404);
  }

  return ok({ run }, { status: 201 });
}
