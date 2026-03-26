import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { getSanitizedSettings, updateSettings } from "@/lib/settings";

export async function GET() {
  await requireUser();
  return ok({ settings: getSanitizedSettings() });
}

export async function PUT(request: Request) {
  await requireUser();

  try {
    const payload = await request.json();
    return ok({ settings: updateSettings(payload) });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to update settings");
  }
}
