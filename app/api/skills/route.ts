import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createSkill, listSkills } from "@/lib/skills";
import { badRequest, ok } from "@/lib/http";

export async function GET() {
  await requireUser();
  return ok({ skills: listSkills() });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1)
});

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid skill data");

  return ok({ skill: createSkill(body.data) }, { status: 201 });
}
