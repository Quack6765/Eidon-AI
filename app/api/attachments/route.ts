import { z } from "zod";

import { createAttachments } from "@/lib/attachments";
import { requireUser } from "@/lib/auth";
import { getConversation } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const formSchema = z.object({
  conversationId: z.string().min(1)
});

async function parseFormData(request: Request): Promise<FormData> {
  const body = await request.arrayBuffer();
  return new Response(body, { headers: request.headers }).formData();
}

export async function POST(request: Request) {
  const user = await requireUser(false);

  if (!user) {
    return badRequest("Authentication required", 401);
  }

  let formData: FormData;

  try {
    formData = await parseFormData(request);
  } catch {
    return badRequest("Invalid attachment upload");
  }

  const parsed = formSchema.safeParse({
    conversationId: formData.get("conversationId")
  });

  if (!parsed.success) {
    return badRequest("Invalid attachment upload");
  }

  if (!getConversation(parsed.data.conversationId, user.id)) {
    return badRequest("Conversation not found", 404);
  }

  const fileEntries = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);

  if (!fileEntries.length) {
    return badRequest("No files were uploaded");
  }

  const files = await Promise.all(
    fileEntries.map(async (file) => ({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer())
    }))
  );

  try {
    const attachments = await createAttachments(
      parsed.data.conversationId,
      files
    );

    return ok({ attachments }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to upload attachments");
  }
}
