import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { getSanitizedSettings, parseGeneralSettingsInput, updateGeneralSettingsForUser } from "@/lib/settings";

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  let payload;
  try {
    payload = parseGeneralSettingsInput(body);
  } catch {
    return badRequest("Invalid general settings payload");
  }

  try {
    updateGeneralSettingsForUser(user.id, payload);
    return ok({ settings: getSanitizedSettings(user.id) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest("Invalid general settings payload");
    }

    throw error;
  }
}
