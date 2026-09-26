import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { deleteSavedLogin } from "@/lib/saved-logins";

const paramsSchema = z.object({ loginId: z.string().min(1) });

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ loginId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "saved login id");
  if (params instanceof NextResponse) return params;

  if (!deleteSavedLogin(params.loginId, user.id)) return badRequest("Saved login not found", 404);
  return ok({ success: true });
}
