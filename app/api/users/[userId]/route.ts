import { z } from "zod";

import { requireAdminUser, auditLog } from "@/lib/auth";
import { isPasswordLoginEnabled } from "@/lib/env";
import { badRequest, forbidden, notFoundResponse, ok } from "@/lib/http";
import type { AuthUser } from "@/lib/types";
import { deleteManagedUser, updateManagedUser } from "@/lib/users";

const paramsSchema = z.object({
  userId: z.string().min(1)
});

const updateUserSchema = z
  .object({
    username: z.string().trim().min(3).max(32).optional(),
    password: z.string().min(8).optional(),
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

  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid user id");
  }

  const body = updateUserSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid user payload");
  }

  try {
    const updated = await updateManagedUser(params.data.userId, {
      username: body.data.username,
      role: body.data.role,
      password: body.data.password || undefined
    });

    if (!updated) {
      return notFoundResponse("User not found");
    }

    auditLog({
      eventType: "user_updated",
      userId: updated.id,
      username: updated.username,
      detail: `User updated: ${Object.entries(body.data).filter(([k, v]) => v !== undefined && k !== "password").map(([k]) => k).join(", ")}${body.data.password ? ", password_changed" : ""}`
    });

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

  let adminUser: AuthUser;
  try {
    adminUser = await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid user id");
  }

  if (params.data.userId === adminUser.id) {
    return badRequest("You cannot delete your own account");
  }

  try {
    const deleted = deleteManagedUser(params.data.userId);

    if (!deleted) {
      return notFoundResponse("User not found");
    }

    auditLog({
      eventType: "user_deleted",
      userId: params.data.userId,
      detail: `User deleted by admin "${adminUser.username}"`
    });

    return ok({ success: true });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to delete user");
  }
}
