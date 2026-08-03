import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { getSanitizedSettings } from "@/lib/settings";

export async function GET() {
  const user = await requireUser();
  return ok({ settings: getSanitizedSettings(user.id) });
}
