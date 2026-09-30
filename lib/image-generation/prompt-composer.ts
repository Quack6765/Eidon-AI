import type {
  CompiledImageInstruction,
  ImageGenerationAnchor,
  ImageGenerationPlacement,
  ImageGenerationReferenceImage
} from "./types";

const ANCHOR_PHRASES: Record<ImageGenerationAnchor, string> = {
  "top-left": "top-left corner",
  "top": "top centre",
  "top-right": "top-right corner",
  "left": "middle-left",
  "center": "centre",
  "right": "middle-right",
  "bottom-left": "bottom-left corner",
  "bottom": "bottom centre",
  "bottom-right": "bottom-right corner"
};

const ROLE_CLAUSES: Record<ImageGenerationReferenceImage["role"], string> = {
  canvas: "the canvas",
  content: "content to place into the canvas, reproduce it exactly",
  style: "a style reference, match its visual style",
  character: "a character reference, keep this character's appearance consistent"
};

function imageRef(index: number) {
  return `Image ${index + 1}`;
}

export function describeAnchor(anchor: ImageGenerationAnchor) {
  return ANCHOR_PHRASES[anchor];
}

function joinRefs(indices: number[]) {
  const refs = indices.map(imageRef);
  if (refs.length <= 1) return refs[0] ?? "";
  return `${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}`;
}

function subjectPhrase(indices: number[]) {
  return indices.length === 1
    ? `the subject of ${imageRef(indices[0])}`
    : `the subjects of ${joinRefs(indices)}`;
}

function describeSlots(slots: ImageGenerationReferenceImage[]) {
  return slots
    .map((slot, index) => `${imageRef(index)} (${slot.label}) — ${ROLE_CLAUSES[slot.role]}.`)
    .join("\n");
}

function describePlacement(
  placement: ImageGenerationPlacement,
  canvasIndex: number,
  contentIndices: number[]
) {
  const subject = subjectPhrase(contentIndices);
  const canvas = imageRef(canvasIndex);
  if (placement.kind === "semantic") {
    return `Place ${subject} ${placement.hint} in ${canvas}.`;
  }
  return `Place ${subject} in the ${describeAnchor(placement.anchor)} of ${canvas}, about ${placement.widthPercent}% of its width.`;
}

function describeInvariants(slots: ImageGenerationReferenceImage[], canvasIndex: number) {
  const lines: string[] = [];
  if (canvasIndex >= 0) {
    lines.push(
      `Use ${imageRef(canvasIndex)} as the canvas: keep its composition, layout, text and style unchanged except for the change requested below.`
    );
  }
  slots.forEach((slot, index) => {
    if (slot.role !== "content") return;
    lines.push(
      `Reproduce ${imageRef(index)} exactly as it appears in that image — its shape, proportions, letterforms and exact original colours (hue, saturation and brightness) must remain completely unchanged. Do not apply the requested change to it.`
    );
  });
  slots.forEach((slot) => {
    if (slot.preserveNote) lines.push(slot.preserveNote);
  });
  return lines.join("\n");
}

function withAvoidClause(body: string, negativePrompt: string) {
  return negativePrompt ? `${body}\n\nAvoid: ${negativePrompt}` : body;
}

export function composeImagePrompt(input: {
  instruction: CompiledImageInstruction;
  slots?: ImageGenerationReferenceImage[];
}) {
  const { instruction } = input;
  const slots = input.slots ?? [];
  if (!slots.length) return withAvoidClause(instruction.imagePrompt, instruction.negativePrompt);

  const canvasIndex = slots.findIndex((slot) => slot.role === "canvas");
  const effectiveCanvasIndex = canvasIndex >= 0 ? canvasIndex : 0;
  const contentIndices = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.role === "content")
    .map(({ index }) => index);

  const sections = [describeSlots(slots)];

  if (instruction.placement && contentIndices.length) {
    sections.push(describePlacement(instruction.placement, effectiveCanvasIndex, contentIndices));
  }

  const invariants = describeInvariants(slots, effectiveCanvasIndex);
  if (invariants) sections.push(invariants);

  sections.push(`Change requested: ${instruction.imagePrompt}`);

  return withAvoidClause(sections.join("\n\n"), instruction.negativePrompt);
}
