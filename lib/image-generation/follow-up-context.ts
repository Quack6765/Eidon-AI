const IMAGE_RELATION_PATTERN =
  /\b(previous|earlier|last|prior)\b|\bfrom before\b|\bfrom earlier\b|\bsame\b|\banother version\b|\bvariation\b/i;
const IMAGE_EDIT_REFERENCE_PATTERN =
  /\bcombine\b|\bmerge\b|\b(edit|modify|change|adjust|tweak|refine|continue)\b|\b(use|keep|make|turn)\s+(it|them|that|those|this)\b/i;
const GENERATED_IMAGE_REFERENCE_PATTERN =
  /\b(image|images|picture|pictures|photo|photos|render|renders)\b[\s\S]{0,80}\b(you generated|you made|generated|created)\b/i;
const CHAT_IMAGE_REFERENCE_PATTERN =
  /\b(previous|earlier|last|latest|prior)\s+(image|images|picture|pictures|photo|photos|render|renders)\b|\b(image|images|picture|pictures|photo|photos|render|renders)\b[\s\S]{0,40}\b(you generated|you made|generated|created)\b|\b(edit|modify|change|adjust|tweak|refine|combine|merge)\b[\s\S]{0,40}\b(image|images|picture|pictures|photo|photos|render|renders)\b/i;
const FOLLOW_UP_IMAGE_GENERATION_PATTERN =
  /\b(another one|one more|another image|another picture|another photo|another render|new one|same vibe|same style|same aesthetic|same idea|similar one|do another|create another|make another|generate another|try another|continue with another)\b/i;

const IMAGE_OBJECT_PATTERN =
  /\b(images?|pictures?|photos?|portraits?|scenes?|illustrations?|artworks?|renders?|drawings?|paintings?|posters?)\b/i;
const IMAGE_REFERENCE_ANY_PATTERN =
  /\b(images?|pictures?|photos?|portraits?|scenes?|illustrations?|artworks?|renders?|drawings?|paintings?|posters?|generat\w*|creat\w*|mak\w*|draw\w*|render\w*|illustrat\w*|paint\w*)\b/i;

const CREATION_VERB_GROUP =
  "generate|create|make|draw|render|illustrate|paint|design|produce|craft|sketch|depict";
const EDIT_VERB_GROUP =
  "add|remove|put|give|wear|make|turn|change|swap|replace|keep|delete|erase|paint|draw|write|drop|include|extend|enlarge|shrink|flip|rotate|crop|recolor|color|colour|move|stretch|adjust|tweak|refine|edit|update|lower|raise|brighten|darken|blur|sharpen|redraw|redo|regenerate";

const DIRECT_IMAGE_GENERATION_REQUEST_PATTERN = new RegExp(
  `\\b(?:${CREATION_VERB_GROUP})\\b[\\s\\S]{0,60}${IMAGE_OBJECT_PATTERN.source}`,
  "i"
);
const IMAGE_REQUEST_PHRASE_PATTERN =
  /\b(want|like|need|please|can you|could you|would you|will you|give me|show me|send me|help me)\b[\s\S]{0,60}\b(images?|pictures?|photos?|portraits?|scenes?|illustrations?|artworks?|renders?|drawings?|paintings?|posters?)\b/i;

const IMPERATIVE_PREFIX = "^\\s*(?:please\\s+|just\\s+|now\\s+)?(?:can you\\s+|could you\\s+|would you\\s+|will you\\s+)?";
const IMPERATIVE_CREATION_PATTERN = new RegExp(
  `${IMPERATIVE_PREFIX}(?:${CREATION_VERB_GROUP})\\b(?!\\s+(?:sure|certain)\\b)`,
  "i"
);
const IMPERATIVE_DEMONSTRATIVE_PATTERN = new RegExp(
  `${IMPERATIVE_PREFIX}(?:${CREATION_VERB_GROUP})\\s+(?:me\\s+|us\\s+)?(?:it|them|that|this|those|him|her)\\b`,
  "i"
);
const NON_IMAGE_ARTIFACT_PATTERN =
  /\b(reports?|summaries|summary|lists?|emails?|messages?|responses?|replies|reply|codes?|scripts?|functions?|passwords?|hashes|tables?|csv|documents?|docs?|pdfs?|spreadsheets?|transcripts?|captions?|texts?|poems?|stor(y|ies)|essays?|plans?|outlines?|schedules?|agendas?|playlists?|contracts?|conclusions?|logs?|notes?|memor(y|ies)|files?|folders?|charts?|graphs?|diagrams?|flowcharts?|mermaid|tickets?|invoices?|receipts?|badges?|certificates?)\b/i;

const NEGATION_GROUP =
  "do ?n[o']?t|don'?t|dont|never|no more|stop|avoid|quit|refrain from|unless i (?:tell|ask|say|want)|not";
const PROHIBITED_ACTION_PATTERN = new RegExp(
  `\\b(?:${NEGATION_GROUP})\\b\\s+(?:\\w+\\s+){0,2}?(?:generat|creat|mak|draw|render|illustrat|paint|design|produc|craft|sketch|show|send|post|attach|add|remov|delet|eras|chang|turn|swap|replac|put|giv|wear|us|writ)\\w*`,
  "i"
);
const PROHIBITED_WANT_PATTERN =
  /\b(do ?n[o']?t|don'?t|dont|never)\s+(want|need|like|request)\b[\s\S]{0,40}\b(images?|pictures?|photos?|portraits?|scenes?|illustrations?|artworks?|renders?|drawings?|paintings?|posters?)\b/i;
const PROHIBITED_IMAGE_NOUN_PATTERN =
  /(?:^|[.!?;]\s*)\s*(no|never|without)\s+(more\s+|new\s+|further\s+|additional\s+|extra\s+)?(an?\s+|any\s+)?(images?|pictures?|photos?|portraits?|illustrations?|artworks?|renders?|drawings?|paintings?|posters?)\b/i;

const REQUEST_QUESTION_PATTERN = /^\s*(?:please\s+)?(?:can|could|would|will)\s+you\b|^\s*(?:may i|let'?s\b|lets\b)/i;
const IMAGE_META_QUESTION_PATTERN =
  /\b(why|what|when|where|how|who)\b[^?]{0,60}\b(you|your)\b|\b(did|have|had|was|were)\s+you\b/i;

const IMAGE_EDIT_VERB_LED_PATTERN = new RegExp(
  `^\\s*(?:please\\s+|just\\s+|now\\s+)?(?:can you\\s+|could you\\s+|would you\\s+)?(?:${EDIT_VERB_GROUP})\\b`,
  "i"
);
const IMAGE_EDIT_DEMONSTRATIVE_PATTERN = new RegExp(
  `\\b(?:${EDIT_VERB_GROUP})\\b[\\s\\S]{0,24}\\b(it|them|that|those|this|him|her)\\b`,
  "i"
);
const LEADING_ASSURANCE_PHRASE_PATTERN =
  /^\s*(?:please\s+|just\s+|now\s+)?(?:can you\s+|could you\s+|would you\s+)?(?:make|do)\s+(?:sure|certain)\b/i;
const BARE_ACKNOWLEDGMENT_PATTERN =
  /^(?:no|nope|nah|yes|yeah|yep|yup|ok|okay|sure|hmm|hm|wow|thanks?|ty|cool|nice|great|perfect)\.?[!?]?$/i;
const TASK_VERB_LED_PATTERN =
  /^\s*(?:please\s+|just\s+|now\s+)?(?:can you\s+|could you\s+|would you\s+|will you\s+)?(?:summarize|summarise|audit|fix|build|deploy|migrate|research|analyze|analyse|explain|review|check|test|run|install|configure|refactor|debug|investigate|compare|translate|write|draft|reply|email|search|find|calculate|compute|count|list|sort|filter|reconcile|schedule|book|order|buy|send|post|publish|commit|push|merge)\b/i;

const DONT_FORGET_TO_PATTERN = /\b(do ?n[o']?t|don'?t|dont)\s+forget\s+to\b/gi;

function normalizeRequestText(text: string) {
  return text.replace(DONT_FORGET_TO_PATTERN, "please").trim();
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

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

export function hasProhibitedImageIntent(text: string) {
  const normalized = normalizeRequestText(text);
  return (
    PROHIBITED_ACTION_PATTERN.test(normalized) ||
    PROHIBITED_WANT_PATTERN.test(normalized) ||
    PROHIBITED_IMAGE_NOUN_PATTERN.test(normalized)
  );
}

export function isImageMetaDiscussion(text: string) {
  const normalized = normalizeRequestText(text);
  if (!normalized.includes("?")) return false;
  if (REQUEST_QUESTION_PATTERN.test(normalized)) return false;
  return IMAGE_META_QUESTION_PATTERN.test(normalized) && IMAGE_REFERENCE_ANY_PATTERN.test(normalized);
}

export function isExplicitImageRequest(text: string) {
  const normalized = normalizeRequestText(text);
  if (!normalized) return false;
  if (hasProhibitedImageIntent(normalized) || isImageMetaDiscussion(normalized)) return false;
  return (
    DIRECT_IMAGE_GENERATION_REQUEST_PATTERN.test(normalized) ||
    IMAGE_REQUEST_PHRASE_PATTERN.test(normalized) ||
    (IMPERATIVE_CREATION_PATTERN.test(normalized) &&
      !IMPERATIVE_DEMONSTRATIVE_PATTERN.test(normalized) &&
      !NON_IMAGE_ARTIFACT_PATTERN.test(normalized) &&
      countWords(normalized) <= 24)
  );
}

export function isImageEditContinuation(text: string, activeImageContext: boolean) {
  const normalized = normalizeRequestText(text);
  if (!activeImageContext || !normalized) return false;
  if (hasProhibitedImageIntent(normalized) || isImageMetaDiscussion(normalized)) return false;
  if (referencesEarlierImageInChat(normalized)) return true;
  if (FOLLOW_UP_IMAGE_GENERATION_PATTERN.test(normalized)) return true;
  if (NON_IMAGE_ARTIFACT_PATTERN.test(normalized)) return false;
  if (LEADING_ASSURANCE_PHRASE_PATTERN.test(normalized)) return false;
  if (IMAGE_EDIT_VERB_LED_PATTERN.test(normalized) || IMAGE_EDIT_DEMONSTRATIVE_PATTERN.test(normalized)) return true;
  if (BARE_ACKNOWLEDGMENT_PATTERN.test(normalized) || TASK_VERB_LED_PATTERN.test(normalized)) return false;
  return countWords(normalized) <= 16;
}

export function isImageGenerationRequested(text: string, activeImageContext: boolean) {
  return isExplicitImageRequest(text) || isImageEditContinuation(text, activeImageContext);
}
