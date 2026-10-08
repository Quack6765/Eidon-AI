import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { RequestBodyTooLargeError, readRequestBodyWithLimit } from "@/lib/bounded-request";
import {
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_REQUEST_BYTES,
  MAX_RESEARCH_PLAN_STEPS,
  MAX_RESEARCH_PLAN_STEP_CHARS
} from "@/lib/constants";
import { badRequest, ok, payloadTooLarge } from "@/lib/http";
import { getProviderReadinessError } from "@/lib/provider-adapters";
import { generateResearchPlan } from "@/lib/research-plan";
import { getDefaultRuntimeProviderProfile, getRuntimeProviderProfile } from "@/lib/settings";

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS),
    providerProfileId: z.string().min(1).optional(),
    currentPlan: z
      .array(z.string().trim().min(1).max(MAX_RESEARCH_PLAN_STEP_CHARS))
      .min(1)
      .max(MAX_RESEARCH_PLAN_STEPS)
      .optional(),
    instruction: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS).optional()
  })
  .refine(
    (body) => (body.currentPlan === undefined) === (body.instruction === undefined),
    { message: "currentPlan and instruction must be provided together" }
  );

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
    getDefaultRuntimeProviderProfile(user.id);
  if (!settings) return badRequest("No provider profile configured");
  const readinessError = getProviderReadinessError(settings, user.id);
  if (readinessError) return badRequest(readinessError);

  try {
    const plan = await generateResearchPlan({
      message: payload.data.message,
      settings,
      abortSignal: request.signal,
      currentPlan: payload.data.currentPlan,
      instruction: payload.data.instruction
    });
    return ok({ plan });
  } catch {
    return badRequest("The research plan could not be updated", 502);
  }
}
