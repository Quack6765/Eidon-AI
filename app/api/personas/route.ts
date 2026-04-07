import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { listPersonas, createPersona } from "@/lib/personas";
import { badRequest, ok } from "@/lib/http";

export async function GET() {
  await requireUser();
  return ok({ personas: listPersonas() });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  content: z.string().min(1)
});

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid persona data");

  return ok({ persona: createPersona(body.data) }, { status: 201 });
}