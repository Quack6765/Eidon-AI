import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createAutomation, listAutomations } from "@/lib/automations";
import { badRequest, ok } from "@/lib/http";
import { getPersona } from "@/lib/personas";
import { getProviderProfile } from "@/lib/settings";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1),
  providerProfileId: z.string().min(1),
  personaId: z.string().min(1).nullable().default(null),
  scheduleKind: z.enum(["interval", "calendar"]),
  intervalMinutes: z.number().int().nullable(),
  calendarFrequency: z.enum(["daily", "weekly"]).nullable(),
  timeOfDay: z.string().nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  enabled: z.boolean().default(true)
});

export async function GET() {
  await requireUser();
  return ok({ automations: listAutomations() });
}

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid automation data");
  }

  if (!getProviderProfile(body.data.providerProfileId)) {
    return badRequest("Provider profile not found", 404);
  }

  if (body.data.personaId && !getPersona(body.data.personaId)) {
    return badRequest("Persona not found", 404);
  }

  try {
    return ok({ automation: createAutomation(body.data) }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid automation data");
  }
}
