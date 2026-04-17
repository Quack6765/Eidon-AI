import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import {
  getSanitizedSettings,
  parseImageGenerationSettingsInput,
  updateImageGenerationSettings
} from "@/lib/settings";

export async function PUT(request: Request) {
  const user = await requireUser();

  if (user.role !== "admin") {
    return badRequest("Only admins can update image generation settings", 403);
  }

  const body = await request.json().catch(() => ({}));
  let payload;
  try {
    payload = parseImageGenerationSettingsInput(body);
  } catch {
    return badRequest("Invalid image generation settings payload");
  }

  try {
    updateImageGenerationSettings(payload);
    return ok({ settings: getSanitizedSettings(user.id) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest("Invalid image generation settings payload");
    }

    throw error;
  }
}
