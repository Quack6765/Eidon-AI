import type { AppSettings } from "@/lib/types";
import type { CompiledImageInstruction, GenerateImageResult } from "./types";

export type ComfyUiConnection = {
  waitForPromptDone: () => Promise<void>;
  close: () => void;
};

type ComfyUiNodeOutput = {
  images: Array<{ filename: string; subfolder: string; type: string }>;
};

type ComfyUiPromptHistory = {
  outputs: Record<string, ComfyUiNodeOutput>;
};

function setPathValue(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === undefined || typeof current[key] !== "object" || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function buildHeaders(authType: AppSettings["comfyuiAuthType"], bearerToken: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authType === "bearer") {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

export async function generateComfyUiImages(input: {
  settings: Pick<
    AppSettings,
    | "comfyuiBaseUrl"
    | "comfyuiAuthType"
    | "comfyuiBearerToken"
    | "comfyuiWorkflowJson"
    | "comfyuiPromptPath"
    | "comfyuiNegativePromptPath"
    | "comfyuiWidthPath"
    | "comfyuiHeightPath"
    | "comfyuiSeedPath"
  >;
  instruction: CompiledImageInstruction;
  clientId: string;
  fetchImpl?: typeof fetch;
  connectWebSocket?: (url: string) => Promise<ComfyUiConnection>;
}): Promise<GenerateImageResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const connectWebSocket =
    input.connectWebSocket ??
    (async () => ({ waitForPromptDone: async () => {}, close: () => {} }));

  const baseUrl = input.settings.comfyuiBaseUrl.replace(/\/+$/, "");
  const workflow = JSON.parse(input.settings.comfyuiWorkflowJson) as Record<string, unknown>;

  if (input.settings.comfyuiPromptPath) {
    setPathValue(workflow, input.settings.comfyuiPromptPath, input.instruction.imagePrompt);
  }
  if (input.settings.comfyuiNegativePromptPath && input.instruction.negativePrompt) {
    setPathValue(workflow, input.settings.comfyuiNegativePromptPath, input.instruction.negativePrompt);
  }
  if (input.settings.comfyuiWidthPath && input.instruction.width) {
    setPathValue(workflow, input.settings.comfyuiWidthPath, input.instruction.width);
  }
  if (input.settings.comfyuiHeightPath && input.instruction.height) {
    setPathValue(workflow, input.settings.comfyuiHeightPath, input.instruction.height);
  }
  if (input.settings.comfyuiSeedPath && input.instruction.seed !== undefined) {
    setPathValue(workflow, input.settings.comfyuiSeedPath, input.instruction.seed);
  }

  const queueBody = { ...workflow, client_id: input.clientId };
  const queueResponse = await fetchImpl(`${baseUrl}/prompt`, {
    method: "POST",
    headers: buildHeaders(input.settings.comfyuiAuthType, input.settings.comfyuiBearerToken),
    body: JSON.stringify(queueBody)
  });

  if (!queueResponse.ok) {
    throw new Error(`ComfyUI queue failed: ${queueResponse.status} ${queueResponse.statusText}`);
  }

  const { prompt_id } = (await queueResponse.json()) as { prompt_id: string };

  const wsUrl = baseUrl.replace(/^http/, "ws") + `/ws?clientId=${input.clientId}`;
  const ws = await connectWebSocket(wsUrl);
  await ws.waitForPromptDone();
  ws.close();

  const historyResponse = await fetchImpl(`${baseUrl}/history/${prompt_id}`, {
    headers: buildHeaders(input.settings.comfyuiAuthType, input.settings.comfyuiBearerToken)
  });

  if (!historyResponse.ok) {
    throw new Error(`ComfyUI history failed: ${historyResponse.status} ${historyResponse.statusText}`);
  }

  const historyData = (await historyResponse.json()) as Record<string, ComfyUiPromptHistory>;

  const promptHistory = historyData[prompt_id];
  if (!promptHistory?.outputs) {
    throw new Error("ComfyUI returned no outputs for the prompt");
  }

  const images: GenerateImageResult["images"] = [];
  for (const nodeOutput of Object.values(promptHistory.outputs)) {
    if (!nodeOutput?.images) continue;
    for (const imageInfo of nodeOutput.images) {
      const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=${encodeURIComponent(imageInfo.type)}`;
      const viewResponse = await fetchImpl(viewUrl, {
        headers: buildHeaders(input.settings.comfyuiAuthType, input.settings.comfyuiBearerToken)
      });

      if (!viewResponse.ok) {
        throw new Error(`ComfyUI view failed: ${viewResponse.status} ${viewResponse.statusText}`);
      }

      const bytes = Buffer.from(await viewResponse.arrayBuffer());
      const contentType = viewResponse.headers.get("content-type") ?? "image/png";
      images.push({
        bytes,
        mimeType: contentType,
        filename: imageInfo.filename
      });
    }
  }

  return {
    assistantText: input.instruction.assistantText || "",
    images
  };
}
