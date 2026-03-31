import { requireUser } from "@/lib/auth";
import { createFolder, listFolders, reorderFolders } from "@/lib/folders";
import { ok, badRequest } from "@/lib/http";
import { z } from "zod";

export async function GET() {
  await requireUser();
  return ok({ folders: listFolders() });
}

const createSchema = z.object({ name: z.string().min(1).max(100) });

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) {
    return badRequest("Invalid folder name");
  }
  return ok({ folder: createFolder(body.data.name) }, { status: 201 });
}

export async function PUT(request: Request) {
  await requireUser();
  const body = await request.json() as string[];
  if (!Array.isArray(body) || !body.every((folderId) => typeof folderId === "string" && folderId.length > 0)) {
    return badRequest("Invalid folder reorder payload");
  }
  reorderFolders(body);
  return ok({ success: true });
}
