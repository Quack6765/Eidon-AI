import { z } from "zod";

import { MAX_AUTOMATION_RUN_TIMEOUT_MINUTES } from "@/lib/constants";

import { requireUser } from "@/lib/auth";
import { createAutomation, listAutomations } from "@/lib/automations";
import { badRequest, ok } from "@/lib/http";
import { getPersona } from "@/lib/personas";
import { getProviderProfile } from "@/lib/settings";
import { getBot } from "@/lib/bots";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1),
  providerProfileId: z.string().min(1),
  personaId: z.string().min(1).nullable().default(null),
  botId: z.string().min(1).nullable().default(null),
  scheduleKind: z.enum(["interval", "calendar"]),
  intervalMinutes: z.number().int().nullable(),
  calendarFrequency: z.enum(["daily", "weekly"]).nullable(),
  timeOfDay: z.string().nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  enabled: z.boolean().default(true),
  research: z.boolean().default(false),
  runTimeoutMinutes: z.number().int().min(1).max(MAX_AUTOMATION_RUN_TIMEOUT_MINUTES).nullable().default(null)
});

export async function GET() {
  const user = await requireUser();
  return ok({ automations: listAutomations(user.id) });
}

export async function POST(request: Request) {
  const user = await requireUser();
  const body = createSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid automation data");
  }

  if (!getProviderProfile(body.data.providerProfileId)) {
    return badRequest("Provider profile not found", 404);
  }

  if (body.data.personaId && !getPersona(body.data.personaId, user.id)) {
    return badRequest("Persona not found", 404);
  }

  if (body.data.botId && !getBot(body.data.botId, user.id)) {
    return badRequest("Bot not found", 404);
  }

  try {
    return ok({ automation: createAutomation(body.data, user.id) }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid automation data");
  }
}
