import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { listPersonas, createPersona } from "@/lib/personas";
import { badRequest, ok } from "@/lib/http";

export async function GET() {
  const user = await requireUser();
  return ok({ personas: listPersonas(user.id) });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  content: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid persona data");

  return ok({ persona: createPersona(body.data, user.id) }, { status: 201 });
}
