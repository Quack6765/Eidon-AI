const IMAGE_RELATION_PATTERN =
  /\b(previous|earlier|last|prior)\b|\bfrom before\b|\bfrom earlier\b|\bsame\b|\banother version\b|\bvariation\b/i;
const IMAGE_EDIT_REFERENCE_PATTERN =
  /\bcombine\b|\bmerge\b|\b(edit|modify|change|adjust|tweak|refine|continue)\b|\b(use|keep|make|turn)\s+(it|them|that|those|this)\b/i;
const GENERATED_IMAGE_REFERENCE_PATTERN =
  /\b(image|images|picture|pictures|photo|photos|render|renders)\b[\s\S]{0,80}\b(you generated|you made|generated|created)\b/i;
const CHAT_IMAGE_REFERENCE_PATTERN =
  /\b(previous|earlier|last|latest|prior)\s+(image|images|picture|pictures|photo|photos|render|renders)\b|\b(image|images|picture|pictures|photo|photos|render|renders)\b[\s\S]{0,40}\b(you generated|you made|generated|created)\b|\b(edit|modify|change|adjust|tweak|refine|combine|merge)\b[\s\S]{0,40}\b(image|images|picture|pictures|photo|photos|render|renders)\b/i;
const DIRECT_IMAGE_GENERATION_REQUEST_PATTERN =
  /\b(generate|create|make|draw|render|illustrate|paint|design|produce|craft)\b[\s\S]{0,60}\b(image|images|picture|pictures|photo|photos|portrait|portraits|scene|scenes|illustration|illustrations|artwork|artworks|render|renders)\b/i;
const FOLLOW_UP_IMAGE_GENERATION_PATTERN =
  /\b(another one|one more|another image|another picture|another photo|another render|new one|same vibe|same style|same aesthetic|same idea|similar one|do another|create another|make another|generate another|try another|continue with another)\b/i;

export function referencesEarlierImagePromptContext(text: string) {
  return (
    IMAGE_RELATION_PATTERN.test(text) ||
    IMAGE_EDIT_REFERENCE_PATTERN.test(text) ||
    GENERATED_IMAGE_REFERENCE_PATTERN.test(text)
  );
}

export function referencesEarlierImageInChat(text: string) {
  return CHAT_IMAGE_REFERENCE_PATTERN.test(text);
}

export function isFreshImageGenerationRequest(text: string, hasPriorImageContext: boolean) {
  if (DIRECT_IMAGE_GENERATION_REQUEST_PATTERN.test(text)) {
    return true;
  }

  if (!hasPriorImageContext) {
    return false;
  }

  return (
    FOLLOW_UP_IMAGE_GENERATION_PATTERN.test(text) ||
    (
      referencesEarlierImagePromptContext(text) &&
      /\b(edit|modify|change|adjust|tweak|refine|continue|combine|merge|use|keep|make|turn)\b/i.test(text)
    )
  );
}
