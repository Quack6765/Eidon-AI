import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { runAutomationNow } from "@/lib/automation-scheduler";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  automationId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "automation id");
  if (params instanceof NextResponse) return params;

  const run = await runAutomationNow(params.automationId, user.id);

  if (!run) {
    return badRequest("Automation not found", 404);
  }

  return ok({ run }, { status: 201 });
}
