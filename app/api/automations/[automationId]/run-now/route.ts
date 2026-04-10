import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { runAutomationNow } from "@/lib/automation-scheduler";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  automationId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid automation id");
  }

  const run = await runAutomationNow(params.data.automationId);

  if (!run) {
    return badRequest("Automation not found", 404);
  }

  return ok({ run }, { status: 201 });
}
