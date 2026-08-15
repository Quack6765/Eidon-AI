import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import {
  imageGenerationIntegrationUpdateSchema,
  speechTranscriptionIntegrationUpdateSchema,
  webSearchIntegrationUpdateSchema
} from "@/lib/integration-settings";
import { disposeTitleModel, initTitleModel } from "@/lib/local-title-model";
import { updateGeneralSettingsBundleForUser } from "@/lib/settings";
import { getWebSearchEndpointUrl, isPublicHttpUrl } from "@/lib/web-search-catalog";

const inputSchema = z.object({
  preferences: z.object({
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]).optional(),
    mcpTimeout: z.number().int().min(10_000).max(600_000).optional(),
    maxAssistantToolSteps: z.number().int().min(1).max(1000).optional(),
    confirmExternalLinks: z.boolean().optional(),
    memoriesEnabled: z.boolean().optional(),
    memoriesMaxCount: z.number().int().min(1).max(500).optional(),
    memoriesRigor: z.enum(["low", "balanced", "high"]).optional()
  }),
  webSearch: webSearchIntegrationUpdateSchema.optional(),
  speechTranscription: speechTranscriptionIntegrationUpdateSchema.optional(),
  imageGeneration: imageGenerationIntegrationUpdateSchema.optional(),
  titleGeneration: z.object({
    titleGenerationMode: z.enum(["same", "specific", "local"]),
    titleGenerationProfileId: z.string().nullable()
  }).optional()
});

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = inputSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return badRequest(body.error.issues.map((issue) => issue.message).join("; "));
  }
  const webSearchEndpointUrl = getWebSearchEndpointUrl(body.data.webSearch);
  if (
    webSearchEndpointUrl !== null
    && user.role !== "admin"
    && !(await isPublicHttpUrl(webSearchEndpointUrl))
  ) {
    return forbidden("Only admins can point web search at private network addresses.");
  }
  try {
    const settings = updateGeneralSettingsBundleForUser(
      user.id,
      body.data,
      user.role === "admin"
    );
    if (body.data.titleGeneration?.titleGenerationMode === "local") {
      void initTitleModel().catch(() => undefined);
    } else if (body.data.titleGeneration) {
      disposeTitleModel();
    }
    return ok({ settings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map((issue) => issue.message).join("; "));
    }
    const message = error instanceof Error ? error.message : "Unable to save settings";
    return badRequest(message, message === "Only admins can update global settings" ? 403 : 400);
  }
}
