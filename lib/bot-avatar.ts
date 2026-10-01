export const AVATAR_DICEBEAR_STYLE = "voxel-bot";
export const AVATAR_ART = "voxel-bot-head-v2";
export const AVATAR_ANIMATION_VARIANT = "medium";
export const AVATAR_SOURCE_SIZE = 512;
export const AVATAR_BACKGROUND_COLOR = "00000000";
export const AVATAR_VIEWBOX = "19 -3 88 88";
export const AVATAR_BODY_COLORS = [
  "8b5cf6",
  "a78bfa",
  "818cf8",
  "6366f1",
  "22d3ee",
  "14b8a6",
  "10b981",
  "f59e0b",
  "f472b6"
];
export const AVATAR_TOP_VARIANTS = ["antenna", "dish"];

const UNSAFE_INLINE_SVG_PATTERNS = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /<\s*iframe/i,
  /<\s*image/i,
  /<\s*animate/i,
  /<\s*set\b/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /\bhref\s*=\s*"(?!#)/i,
  /\bhref\s*=\s*'(?!#)/i,
  /xlink:href\s*=\s*"(?!#)/i,
  /xlink:href\s*=\s*'(?!#)/i
];

export function buildBotAvatarUrl(seed: string) {
  return `/api/avatars/${encodeURIComponent(seed)}.svg?v=${AVATAR_ART}`;
}

export function buildAnimatedBotAvatarUrl(seed: string) {
  return `${buildBotAvatarUrl(seed)}&animated=1`;
}

export function applyAvatarViewBox(svg: string) {
  return svg.replace(/viewBox="[^"]*"/, `viewBox="${AVATAR_VIEWBOX}"`);
}

export function stripAvatarAnimationStyle(svg: string) {
  return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

export function wrapAvatarEyes(svg: string) {
  return svg.replace(
    /(<use\b[^>]*href="#eyes-[^"]*"[^>]*\/>)/g,
    '<g class="bot-eyes">$1</g>'
  );
}

export function assertSafeInlineSvg(svg: string | null) {
  if (!svg || !svg.startsWith("<svg")) {
    return null;
  }
  return UNSAFE_INLINE_SVG_PATTERNS.some((pattern) => pattern.test(svg)) ? null : svg;
}
