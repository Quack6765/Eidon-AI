import { z } from "zod";
import type { ProviderProfileWithApiKey, PromptMessage } from "@/lib/types";
import { callProviderText as callProviderTextDefault } from "@/lib/provider";
import type { CompiledImageInstruction } from "./types";
import { referencesEarlierImagePromptContext } from "./follow-up-context";

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

function stringifyPromptContent(content: PromptMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      return `[Attached image: ${part.filename}]`;
    })
    .filter(Boolean)
    .join("\n");
}

function getLatestUserImageRequest(messages: PromptMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return stringifyPromptContent(message.content).trim();
    }
  }

  return "";
}

function getLatestUserIndex(messages: PromptMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function getRelevantPriorUserRequests(messages: PromptMessage[], latestUserIndex: number) {
  if (latestUserIndex <= 0) {
    return "";
  }

  return messages
    .slice(0, latestUserIndex)
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => `user: ${stringifyPromptContent(message.content)}`)
    .join("\n");
}

function buildImageInstructionPrompt(messages: PromptMessage[]): string {
  const latestUserIndex = getLatestUserIndex(messages);
  const latestUserRequest = getLatestUserImageRequest(messages);
  const priorUserRequests = getRelevantPriorUserRequests(messages, latestUserIndex);
  const includePriorContext = referencesEarlierImagePromptContext(latestUserRequest);

  return `You are an image generation instruction compiler. Base the prompt and count on only the latest user image request by default. Use earlier image requests only when the latest request explicitly asks to modify or combine prior results. Produce a JSON object with these fields:
- imagePrompt: string (required, the detailed image generation prompt)
- negativePrompt: string (optional, things to exclude)
- assistantText: string (optional, brief message to show the user)
- aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" (default: "1:1")
- count: number 1-4 (default: 1)

Return ONLY the JSON object wrapped in a \`\`\`json code block.

${includePriorContext ? `Relevant earlier user image requests:
${priorUserRequests || "(none)"}

` : ""}Latest user request:
user: ${latestUserRequest}`;
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
