import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listToolApprovalRules } from "@/lib/tool-approvals";

export async function GET() {
  const user = await requireUser();
  return ok({ rules: listToolApprovalRules(user.id) });
}
