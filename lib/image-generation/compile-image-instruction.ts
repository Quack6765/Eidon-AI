import { z } from "zod";
import sharp from "sharp";
import type { RuntimeProviderProfile, PromptMessage } from "@/lib/types";
import { resolveAttachmentPath } from "@/lib/attachments";
import { callProviderText as callProviderTextDefault } from "@/lib/provider";
import type { CompiledImageInstruction } from "./types";
import { referencesEarlierImagePromptContext, isExplicitImageRequest } from "./follow-up-context";
import { hasActiveImageSession } from "@/lib/prompt-analysis";

const compiledInstructionSchema = z.object({
  mode: z.enum(["generate", "edit"]).default("generate"),
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

async function describeLatestUserImages(messages: PromptMessage[]) {
  const latestUserIndex = getLatestUserIndex(messages);
  if (latestUserIndex < 0) {
    return "";
  }

  const content = messages[latestUserIndex].content;
  if (typeof content === "string") {
    return "";
  }

  const lines: string[] = [];

  for (const part of content) {
    if (part.type !== "image") continue;
    let dimensions = "";
    try {
      const metadata = await sharp(resolveAttachmentPath({ relativePath: part.relativePath })).metadata();
      if (metadata.width && metadata.height) {
        dimensions = ` (${metadata.width}x${metadata.height})`;
      }
    } catch {}
    lines.push(`- ${part.filename}${dimensions}`);
  }

  if (!lines.length) {
    return "";
  }

  return [
    "Images attached to the latest user request (their bytes are provided to the image backend as edit inputs whenever mode is \"edit\"):",
    ...lines,
    ""
  ].join("\n");
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

async function buildImageInstructionPrompt(messages: PromptMessage[]): Promise<string> {
  const latestUserIndex = getLatestUserIndex(messages);
  const latestUserRequest = getLatestUserImageRequest(messages);
  const priorUserRequests = getRelevantPriorUserRequests(messages, latestUserIndex);
  const isFollowUpRevision = !isExplicitImageRequest(latestUserRequest) && hasActiveImageSession(messages);
  const includePriorContext = referencesEarlierImagePromptContext(latestUserRequest) || isFollowUpRevision;
  const imageDescriptors = await describeLatestUserImages(messages);

  return `You are an image generation instruction compiler. Base the prompt and count on only the latest user image request by default. Use earlier image requests only when the latest request explicitly asks to modify or combine prior results. Produce a JSON object with these fields:
- mode: "generate" | "edit" (default: "generate"). Use "edit" whenever the latest user message attaches an image and the request asks to change, modify, recolor, restyle, annotate, remove, add, or combine elements of that image, and whenever it modifies images generated earlier in the conversation. Use "generate" only for unrelated new images.${isFollowUpRevision ? " The latest request is a short follow-up revising a recently generated image — treat it as revising that image (prefer mode \"edit\" with the previous generated image as input) unless it clearly asks for something unrelated." : ""}
- imagePrompt: string (required, the detailed image generation prompt; for "edit" phrase it as a change instruction applied to the existing image, e.g. "color every key blue while keeping the exact layout, labels, and fonts" - never as a fresh scene description)
- negativePrompt: string (optional, things to exclude)
- assistantText: string (optional, brief message to show the user)
- aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" (default: "1:1")
- count: number 1-4 (default: 1)

Return ONLY the JSON object wrapped in a \`\`\`json code block.

${includePriorContext ? `Relevant earlier user image requests:
${priorUserRequests || "(none)"}

` : ""}${imageDescriptors}Latest user request:
user: ${latestUserRequest}`;
}

export async function compileImageInstruction(input: {
  settings: RuntimeProviderProfile;
  promptMessages: PromptMessage[];
  conversationId?: string;
  callProviderText?: typeof callProviderTextDefault;
  abortSignal?: AbortSignal;
}): Promise<CompiledImageInstruction> {
  const call = input.callProviderText ?? callProviderTextDefault;
  const prompt = await buildImageInstructionPrompt(input.promptMessages);
  const raw = await call({
    settings: input.settings,
    prompt,
    purpose: "image_instruction",
    conversationId: input.conversationId,
    abortSignal: input.abortSignal
  });

  return compiledInstructionSchema.parse(
    extractJsonObject(raw)
  ) as CompiledImageInstruction;
}
