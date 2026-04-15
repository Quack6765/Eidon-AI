import { z } from "zod";
import type { ProviderProfileWithApiKey, PromptMessage } from "@/lib/types";
import { callProviderText as callProviderTextDefault } from "@/lib/provider";
import type { CompiledImageInstruction } from "./types";

const compiledInstructionSchema = z.object({
  imagePrompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  assistantText: z.string().default(""),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  seed: z.number().int().nonnegative().optional(),
  count: z.number().int().min(1).max(4).default(1)
});

export function extractJsonObject(raw: string) {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Provider returned invalid image instruction JSON");
  }

  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function buildImageInstructionPrompt(messages: PromptMessage[]): string {
  const conversationContext = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  return `You are an image generation instruction compiler. Based on the conversation below, produce a JSON object with these fields:
- imagePrompt: string (required, the detailed image generation prompt)
- negativePrompt: string (optional, things to exclude)
- assistantText: string (optional, brief message to show the user)
- aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" (default: "1:1")
- count: number 1-4 (default: 1)

Return ONLY the JSON object wrapped in a \`\`\`json code block.

Conversation:
${conversationContext}`;
}

export async function compileImageInstruction(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  callProviderText?: typeof callProviderTextDefault;
}): Promise<CompiledImageInstruction> {
  const call = input.callProviderText ?? callProviderTextDefault;
  const prompt = buildImageInstructionPrompt(input.promptMessages);
  const raw = await call({
    settings: input.settings,
    prompt,
    purpose: "image_instruction"
  });

  return compiledInstructionSchema.parse(
    extractJsonObject(raw)
  ) as CompiledImageInstruction;
}
