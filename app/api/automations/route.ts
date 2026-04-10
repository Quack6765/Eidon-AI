import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createAutomation, listAutomations } from "@/lib/automations";
import { badRequest, ok } from "@/lib/http";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1),
  providerProfileId: z.string().min(1),
  personaId: z.string().min(1).nullable().default(null),
  scheduleKind: z.enum(["interval", "calendar"]),
  intervalMinutes: z.number().int().nullable(),
  calendarFrequency: z.enum(["daily", "weekly"]).nullable(),
  timeOfDay: z.string().nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([])
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

  try {
    return ok({ automation: createAutomation(body.data) }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid automation data");
  }
}
