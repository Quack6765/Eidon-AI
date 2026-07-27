import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { CANARY_MODEL_NAME, ensureCanaryModelReady } from "@/lib/speech/canary-model";
import { getSettingsForUser } from "@/lib/settings";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireUser(false);
  if (!user) {
    return badRequest("Authentication required", 401);
  }

  if (getSettingsForUser(user.id).sttEngine !== "embedded") {
    return badRequest("Select Embedded model before preparing Canary speech recognition.", 409);
  }

  try {
    await ensureCanaryModelReady();
    return ok({ model: CANARY_MODEL_NAME, ready: true });
  } catch (error) {
    console.error(`[speech] Failed to prepare ${CANARY_MODEL_NAME}:`, error);
    return badRequest(`Unable to prepare ${CANARY_MODEL_NAME}.`, 503);
  }
}
