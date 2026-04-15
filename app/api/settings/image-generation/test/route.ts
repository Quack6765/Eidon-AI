import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { generateComfyUiImages } from "@/lib/image-generation/comfyui";

export async function POST(request: Request) {
  const user = await requireUser();

  if (user.role !== "admin") {
    return badRequest("Only admins can test ComfyUI workflows", 403);
  }

  const body = await request.json().catch(() => ({}));

  if (body.imageGenerationBackend !== "comfyui") {
    return badRequest("Test route only supports comfyui backend");
  }

  const settings = getSettings();

  if (!settings.comfyuiBaseUrl) {
    return badRequest("ComfyUI base URL is not configured");
  }

  try {
    const result = await generateComfyUiImages({
      settings: {
        comfyuiBaseUrl: settings.comfyuiBaseUrl,
        comfyuiAuthType: settings.comfyuiAuthType,
        comfyuiBearerToken: settings.comfyuiBearerToken,
        comfyuiWorkflowJson: settings.comfyuiWorkflowJson,
        comfyuiPromptPath: settings.comfyuiPromptPath,
        comfyuiNegativePromptPath: settings.comfyuiNegativePromptPath,
        comfyuiWidthPath: settings.comfyuiWidthPath,
        comfyuiHeightPath: settings.comfyuiHeightPath,
        comfyuiSeedPath: settings.comfyuiSeedPath
      },
      instruction: {
        imagePrompt: "test prompt",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      },
      clientId: `admin-test-${Date.now()}`
    });

    return ok({ success: true, imageCount: result.images.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return badRequest(`ComfyUI test failed: ${message}`);
  }
}
