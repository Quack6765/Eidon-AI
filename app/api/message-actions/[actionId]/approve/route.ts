import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { approveMemoryProposal } from "@/lib/memory-proposals";
import {
  approveAutomationProposal
} from "@/lib/automation-proposals";
import { getMessageActionKind } from "@/lib/conversations";

const paramsSchema = z.object({
  actionId: z.string().min(1)
});

const bodySchema = z.object({
  content: z.string().trim().min(1).max(1000).optional(),
  category: z.enum(["personal", "preference", "work", "location", "other"]).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).optional(),
  scheduleKind: z.enum(["interval", "calendar"]).optional(),
  intervalMinutes: z.number().int().nullable().optional(),
  calendarFrequency: z.enum(["daily", "weekly"]).nullable().optional(),
  timeOfDay: z.string().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  continuePreviousConversation: z.boolean().optional()
});

async function parseApprovalBody(request: Request) {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("Invalid approval overrides");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "action id");
  if (params instanceof NextResponse) return params;

  let rawBody: unknown;
  try {
    rawBody = await parseApprovalBody(request);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid approval overrides");
  }

  const body = bodySchema.safeParse(rawBody);
  if (!body.success) return badRequest("Invalid approval overrides");

  try {
    if (getMessageActionKind(params.actionId) === "create_automation") {
      const { action, automation } = approveAutomationProposal(params.actionId, body.data, user.id);
      return ok({ action, automation });
    }

    const action = approveMemoryProposal(params.actionId, body.data, user.id);
    return ok({ action });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to approve proposal");
  }
}
