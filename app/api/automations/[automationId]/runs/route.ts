import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getAutomation, listAutomationRuns } from "@/lib/automations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  automationId: z.string().min(1)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid automation id");
  }

  if (!getAutomation(params.data.automationId)) {
    return badRequest("Automation not found", 404);
  }

  return ok({ runs: listAutomationRuns(params.data.automationId) });
}
