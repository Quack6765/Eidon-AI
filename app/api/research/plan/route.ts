import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { RequestBodyTooLargeError, readRequestBodyWithLimit } from "@/lib/bounded-request";
import { MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_REQUEST_BYTES } from "@/lib/constants";
import { badRequest, ok, payloadTooLarge } from "@/lib/http";
import { generateResearchPlan } from "@/lib/research-plan";
import { getDefaultRuntimeProviderProfile, getRuntimeProviderProfile } from "@/lib/settings";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS),
  providerProfileId: z.string().min(1).optional()
});

export async function POST(request: Request) {
  const user = await requireUser(false);
  if (!user) return badRequest("Authentication required", 401);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(
      Buffer.from(await readRequestBodyWithLimit(request, MAX_CHAT_REQUEST_BYTES)).toString("utf8")
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return payloadTooLarge(error.message);
    return badRequest("Invalid research plan request");
  }
  const payload = bodySchema.safeParse(parsedBody);
  if (!payload.success) return badRequest("Invalid research plan request");

  const settings =
    (payload.data.providerProfileId ? getRuntimeProviderProfile(payload.data.providerProfileId) : null) ??
    getDefaultRuntimeProviderProfile();
  if (!settings) return badRequest("No provider profile configured");

  const plan = await generateResearchPlan({
    message: payload.data.message,
    settings,
    abortSignal: request.signal
  });
  return ok({ plan });
}
