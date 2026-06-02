import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { createSkill, listSkills } from "@/lib/skills";
import { badRequest, forbidden, ok } from "@/lib/http";

export async function GET() {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();
  return ok({ skills: listSkills() });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100).optional().default("Untitled Skill"),
  description: z.string().trim().min(1).optional(),
  content: z.string().min(1)
});

export async function POST(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid skill data");

  return ok({ skill: createSkill(body.data) }, { status: 201 });
}
