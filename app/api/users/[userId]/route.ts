import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { isPasswordLoginEnabled } from "@/lib/env";
import { badRequest, forbidden, notFoundResponse, ok, parseRouteParams } from "@/lib/http";
import { deleteManagedUser, updateManagedUser } from "@/lib/users";

const paramsSchema = z.object({
  userId: z.string().min(1)
});

const updateUserSchema = z
  .object({
    username: z.string().trim().min(3).max(32).optional(),
    password: z.string().min(8).optional().or(z.literal("")),
    role: z.enum(["admin", "user"]).optional()
  })
  .refine(
    (value) =>
      value.username !== undefined || value.password !== undefined || value.role !== undefined,
    { message: "At least one field is required" }
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  if (!isPasswordLoginEnabled()) {
    return notFoundResponse();
  }

  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

    const params = await parseRouteParams(context, paramsSchema, "user id");
  if (params instanceof NextResponse) return params;

  const body = updateUserSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid user payload");
  }

  try {
    const updated = await updateManagedUser(params.userId, {
      username: body.data.username,
      role: body.data.role,
      password: body.data.password || undefined
    });

    if (!updated) {
      return notFoundResponse("User not found");
    }

    return ok({ user: updated });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to update user");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  if (!isPasswordLoginEnabled()) {
    return notFoundResponse();
  }

  const adminUser = await requireAdminResponse();
  if (!adminUser) return forbidden();

    const params = await parseRouteParams(context, paramsSchema, "user id");
  if (params instanceof NextResponse) return params;

  if (params.userId === adminUser.id) {
    return badRequest("You cannot delete your own account");
  }

  try {
    const deleted = deleteManagedUser(params.userId);

    if (!deleted) {
      return notFoundResponse("User not found");
    }

    return ok({ success: true });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to delete user");
  }
}
