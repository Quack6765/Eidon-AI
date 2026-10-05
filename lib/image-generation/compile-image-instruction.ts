import { z } from "zod";
import sharp from "sharp";
import type { RuntimeProviderProfile, PromptMessage } from "@/lib/types";
import { resolveAttachmentPath } from "@/lib/attachments";
import { callProviderText as callProviderTextDefault } from "@/lib/provider";
import {
  IMAGE_GENERATION_ANCHORS,
  IMAGE_GENERATION_IMAGE_ROLES,
  type CompiledImageInstruction
} from "./types";
import { referencesEarlierImagePromptContext, isExplicitImageRequest } from "./follow-up-context";
import { hasActiveImageSession } from "@/lib/prompt-analysis";

const anchorPlacementSchema = z.object({
  kind: z.literal("anchor"),
  anchor: z.enum(IMAGE_GENERATION_ANCHORS),
  widthPercent: z.number().positive().max(100).default(22),
  opacity: z.number().min(0).max(1).default(1),
  rotationDeg: z.number().default(0),
  marginPercent: z.number().min(0).max(50).default(3),
  restyle: z.boolean().default(true)
});

const placementSchema = z.discriminatedUnion("kind", [
  anchorPlacementSchema,
  z.object({ kind: z.literal("semantic"), hint: z.string().min(1) })
]);

const inputSlotSchema = z.object({
  filename: z.string().min(1),
  role: z.enum(IMAGE_GENERATION_IMAGE_ROLES),
  label: z.string().min(1)
});

const compiledInstructionSchema = z.object({
  mode: z.enum(["generate", "edit"]).default("generate"),
  imagePrompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  assistantText: z.string().default(""),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
  count: z.number().int().min(1).max(4).default(1),
  inputs: z.array(inputSlotSchema).optional().catch(undefined),
  placement: placementSchema.optional().catch(undefined)
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
    lines.push(`- Image ${lines.length + 1}: ${part.filename}${dimensions}`);
  }

  if (!lines.length) {
    return "";
  }

  return [
    "Images attached to the latest user request, in the order their bytes are provided to the image backend as edit inputs whenever mode is \"edit\":",
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
- inputs: optional array with one entry per attached image listed above, keeping their order: { filename, role, label }. role is "canvas" when the image is the one to modify, "content" when it is an element to place into the canvas (a logo, a product, a sticker), "style" when it is only a style reference, or "character" when it is a person or character to keep consistent. Infer role from the user's wording and the filenames; name exactly one "canvas". label is a short human phrase for that image such as "the logo" or "base photo". Omit this field entirely when no image is attached.
- placement: optional, set only when the request puts one attached image onto another. Use { "kind": "anchor", "anchor": one of "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right", "widthPercent": number 1-100 (default 22), "opacity": number 0-1 (default 1), "rotationDeg": number (default 0), "marginPercent": number 0-50 (default 3), "restyle": boolean (default true) } when the target is geometric — a corner, an edge, or the centre — and can be positioned without looking at the image. Use { "kind": "semantic", "hint": "a short phrase naming the target, e.g. \"onto the black t-shirt\"" } when the target is a part of the scene that cannot be positioned geometrically, such as "on her jacket" or "on the bottle". Prefer "anchor" whenever the user names a corner, edge or centre. Set restyle to false only when the user wants the placed element pixel-identical and nothing else touched. When placement is set, imagePrompt must describe only the change applied to the canvas — never where the element is placed or how large it should be, because the pipeline positions it geometrically.

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
