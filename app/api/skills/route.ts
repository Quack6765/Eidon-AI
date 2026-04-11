import { z } from "zod";

import { requireAdminUser } from "@/lib/auth";
import { createSkill, listSkills } from "@/lib/skills";
import { badRequest, forbidden, ok } from "@/lib/http";

export async function GET() {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }
  return ok({ skills: listSkills() });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100).optional().default("Untitled Skill"),
  description: z.string().trim().min(1).max(240).optional(),
  content: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid skill data");

  return ok({ skill: createSkill(body.data) }, { status: 201 });
}
