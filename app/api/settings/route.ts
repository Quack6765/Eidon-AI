import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import {
  getSanitizedSettings,
  parseGeneralSettingsInput,
  updateGeneralSettingsForUser
} from "@/lib/settings";

export async function GET() {
  const user = await requireUser();
  return ok({ settings: getSanitizedSettings(user.id) });
}

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  let payload: ReturnType<typeof parseGeneralSettingsInput>;

  try {
    payload = parseGeneralSettingsInput(body);
  } catch {
    return badRequest("Invalid general settings payload");
  }

  try {
    updateGeneralSettingsForUser(user.id, payload);
    return ok({ settings: getSanitizedSettings(user.id) });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to update settings");
  }
}
