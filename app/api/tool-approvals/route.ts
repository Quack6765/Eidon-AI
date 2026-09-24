import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { createCommandApprovalRule, listToolApprovalRules } from "@/lib/tool-approvals";
import { getUserAllowAllTools, setUserAllowAllTools } from "@/lib/user-preferences";
import { z } from "zod";

export async function GET() {
  const user = await requireUser();
  return ok({ allowAll: getUserAllowAllTools(user.id), rules: listToolApprovalRules(user.id) });
}

const settingsSchema = z.object({ allowAll: z.boolean() });

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = settingsSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid tool approval settings");

  setUserAllowAllTools(user.id, body.data.allowAll);
  return ok({ allowAll: body.data.allowAll });
}

const createSchema = z.object({
  command: z.string().trim().min(1).max(200)
});

export async function POST(request: Request) {
  const user = await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid tool approval rule");

  try {
    const rule = createCommandApprovalRule(user.id, body.data.command);
    return ok({ rule }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid tool approval rule");
  }
}
