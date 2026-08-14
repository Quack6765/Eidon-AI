import { z } from "zod";

import { createAttachments } from "@/lib/attachments";
import { requireUser } from "@/lib/auth";
import { RequestBodyTooLargeError, readRequestBodyWithLimit } from "@/lib/bounded-request";
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_UPLOAD_REQUEST_BYTES } from "@/lib/constants";
import { getConversation } from "@/lib/conversations";
import { badRequest, ok, payloadTooLarge } from "@/lib/http";

const formSchema = z.object({
  conversationId: z.string().min(1)
});

async function parseFormData(request: Request): Promise<FormData> {
  const body = await readRequestBodyWithLimit(request, MAX_UPLOAD_REQUEST_BYTES);
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
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return payloadTooLarge(error.message);
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

  if (fileEntries.length > MAX_ATTACHMENTS_PER_UPLOAD) {
    return badRequest(`A maximum of ${MAX_ATTACHMENTS_PER_UPLOAD} files may be uploaded at once`);
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
