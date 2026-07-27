import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getAutomation, listAutomationRunsPage } from "@/lib/automations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  automationId: z.string().min(1)
});

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export async function GET(
  request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "automation id");
  if (params instanceof NextResponse) return params;

  if (!getAutomation(params.automationId, user.id)) {
    return badRequest("Automation not found", 404);
  }

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!query.success) return badRequest("Invalid automation run query");

  try {
    return ok(listAutomationRunsPage({
      automationId: params.automationId,
      userId: user.id,
      ...query.data
    }));
  } catch {
    return badRequest("Invalid automation run cursor");
  }
}
