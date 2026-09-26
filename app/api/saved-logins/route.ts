import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listSavedLogins } from "@/lib/saved-logins";

export async function GET() {
  const user = await requireUser();
  return ok({ savedLogins: listSavedLogins(user.id) });
}
