import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getAutomation, listAutomationRuns } from "@/lib/automations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  automationId: z.string().min(1)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "automation id");
  if (params instanceof NextResponse) return params;

  if (!getAutomation(params.automationId, user.id)) {
    return badRequest("Automation not found", 404);
  }

  return ok({ runs: listAutomationRuns(params.automationId, user.id) });
}
