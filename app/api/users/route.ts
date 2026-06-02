import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { isPasswordLoginEnabled } from "@/lib/env";
import { badRequest, forbidden, notFoundResponse, ok } from "@/lib/http";
import { createLocalUser, listUsers } from "@/lib/users";

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8),
  role: z.enum(["admin", "user"])
});

export async function GET() {
  if (!isPasswordLoginEnabled()) {
    return notFoundResponse();
  }

  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  return ok({ users: listUsers() });
}

export async function POST(request: Request) {
  if (!isPasswordLoginEnabled()) {
    return notFoundResponse();
  }

  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  const body = createUserSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid user payload");
  }

  try {
    const user = await createLocalUser(body.data);
    return ok({ user }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to create user");
  }
}
