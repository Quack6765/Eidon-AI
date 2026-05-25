import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { disposeTitleModel, initTitleModel } from "@/lib/local-title-model";
import {
  getSanitizedSettings,
  updateTitleGenerationSettings
} from "@/lib/settings";

export async function PUT(request: Request) {
  const user = await requireUser();

  if (user.role !== "admin") {
    return badRequest("Only admins can update title generation settings", 403);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const mode = body.titleGenerationMode;
  if (mode !== "same" && mode !== "specific" && mode !== "local") {
    return badRequest("Invalid titleGenerationMode");
  }

  const profileId = body.titleGenerationProfileId as string | null | undefined;

  try {
    updateTitleGenerationSettings({
      titleGenerationMode: mode,
      titleGenerationProfileId: profileId ?? null
    });

    if (mode === "local") {
      initTitleModel().catch((err) => {
        console.error("[title-model] Failed to load after settings change:", err.message);
      });
    } else {
      disposeTitleModel();
    }

    return ok({ settings: getSanitizedSettings(user.id) });
  } catch {
    return badRequest("Failed to save title generation settings");
  }
}
