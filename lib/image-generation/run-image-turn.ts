import { createAttachments } from "@/lib/attachments";
import { bindAttachmentsToMessage, updateMessage, getMessage } from "@/lib/conversations";
import type { AppSettings, Message, ProviderProfileWithApiKey, PromptMessage } from "@/lib/types";
import type { CompiledImageInstruction, GenerateImageResult } from "./types";
import { compileImageInstruction } from "./compile-image-instruction";
import { generateGoogleNanoBananaImages } from "./google-nano-banana";

export type RunImageTurnInput = {
  conversationId: string;
  settings: ProviderProfileWithApiKey;
  appSettings: AppSettings;
  assistantMessageId: string;
  promptMessages: PromptMessage[];
};

export type RunImageTurnFn = (input: RunImageTurnInput) => Promise<{ assistantMessage: Message }>;

export async function runImageTurn(input: RunImageTurnInput): Promise<{ assistantMessage: Message }> {
  const compiled: CompiledImageInstruction = await compileImageInstruction({
    settings: input.settings,
    promptMessages: input.promptMessages
  });

  const backendResult: GenerateImageResult = await generateGoogleNanoBananaImages({
    settings: input.appSettings,
    instruction: compiled
  });

  const attachments = createAttachments(
    input.conversationId,
    backendResult.images.map((img) => ({
      filename: img.filename,
      mimeType: img.mimeType,
      bytes: img.bytes
    }))
  );

  bindAttachmentsToMessage(
    input.conversationId,
    input.assistantMessageId,
    attachments.map((a) => a.id)
  );

  updateMessage(input.assistantMessageId, {
    content: backendResult.assistantText || `Generated ${attachments.length} image${attachments.length === 1 ? "" : "s"}.`,
    thinkingContent: "",
    status: "completed"
  });

  return { assistantMessage: getMessage(input.assistantMessageId)! };
}
