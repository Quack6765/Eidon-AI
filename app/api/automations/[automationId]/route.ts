import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteAutomation, getAutomation, updateAutomation } from "@/lib/automations";
import { badRequest, ok } from "@/lib/http";
import { getPersona } from "@/lib/personas";
import { getProviderProfile } from "@/lib/settings";

const paramsSchema = z.object({
  automationId: z.string().min(1)
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).optional(),
  providerProfileId: z.string().min(1).optional(),
  personaId: z.string().min(1).nullable().optional(),
  scheduleKind: z.enum(["interval", "calendar"]).optional(),
  intervalMinutes: z.number().int().nullable().optional(),
  calendarFrequency: z.enum(["daily", "weekly"]).nullable().optional(),
  timeOfDay: z.string().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  enabled: z.boolean().optional(),
  nextRunAt: z.string().nullable().optional()
}).refine(
  (value) => Object.keys(value).length > 0,
  "Invalid automation update"
);

export async function GET(
  _request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid automation id");
  }

  const automation = getAutomation(params.data.automationId);

  if (!automation) {
    return badRequest("Automation not found", 404);
  }

  return ok({ automation });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid automation id");
  }

  const body = updateSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid automation update");
  }

  const automation = getAutomation(params.data.automationId);

  if (!automation) {
    return badRequest("Automation not found", 404);
  }

  if (body.data.providerProfileId && !getProviderProfile(body.data.providerProfileId)) {
    return badRequest("Provider profile not found", 404);
  }

  if (body.data.personaId && !getPersona(body.data.personaId)) {
    return badRequest("Persona not found", 404);
  }

  try {
    const updated = updateAutomation(automation.id, body.data);
    return ok({ automation: updated });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid automation update");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ automationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid automation id");
  }

  const deleted = deleteAutomation(params.data.automationId);
  if (!deleted) {
    return badRequest("Automation not found", 404);
  }

  return ok({ success: true });
}
