import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { getVapidPublicKey } from "@/lib/push-notifications";

export async function GET() {
  await requireUser();
  return ok({ publicKey: getVapidPublicKey() });
}
