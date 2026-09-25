import { requireUser } from "@/lib/auth";
import { listPendingBotApprovals } from "@/lib/bots";
import { ok } from "@/lib/http";

export async function GET() {
  const user = await requireUser();
  return ok({ approvals: listPendingBotApprovals({ userId: user.id }) });
}
