import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { disposeTitleModel, initTitleModel } from "@/lib/local-title-model";
import {
  getSanitizedSettings,
  parseGeneralSettingsInput,
  updateGeneralSettingsBundleForUser,
  updateGeneralSettingsForUser
} from "@/lib/settings";

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));

  if (body && typeof body === "object" && "general" in body) {
    try {
      const settings = updateGeneralSettingsBundleForUser(
        user.id,
        body,
        user.role === "admin"
      );
      const titleGeneration = (body as {
        titleGeneration?: { titleGenerationMode?: string };
      }).titleGeneration;

      if (titleGeneration?.titleGenerationMode === "local") {
        void initTitleModel().catch(() => undefined);
      } else if (titleGeneration) {
        disposeTitleModel();
      }

      return ok({ settings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(error.issues.map((issue) => issue.message).join("; "));
      }
      return badRequest(error instanceof Error ? error.message : "Unable to save settings");
    }
  }

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
