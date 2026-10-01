import {
  AVATAR_ANIMATION_VARIANT,
  AVATAR_ART,
  AVATAR_BACKGROUND_COLOR,
  AVATAR_BODY_COLORS,
  AVATAR_DICEBEAR_STYLE,
  AVATAR_SOURCE_SIZE,
  AVATAR_TOP_VARIANTS,
  applyAvatarViewBox,
  stripAvatarAnimationStyle,
  wrapAvatarEyes
} from "@/lib/bot-avatar";
import { getDb } from "@/lib/db";

const DICEBEAR_TIMEOUT_MS = 10_000;
const MAX_AVATAR_SVG_LENGTH = 1_000_000;

function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildDiceBearUrl(seed: string, animated: boolean) {
  const hash = hashSeed(seed);
  const params = new URLSearchParams({
    seed,
    size: String(AVATAR_SOURCE_SIZE),
    animationVariant: animated ? AVATAR_ANIMATION_VARIANT : "none",
    backgroundColor: AVATAR_BACKGROUND_COLOR,
    bodyColor: AVATAR_BODY_COLORS[hash % AVATAR_BODY_COLORS.length],
    topVariant: AVATAR_TOP_VARIANTS[(hash >>> 16) % AVATAR_TOP_VARIANTS.length]
  });
  return `https://api.dicebear.com/10.x/${AVATAR_DICEBEAR_STYLE}/svg?${params.toString()}`;
}

async function fetchBotAvatarSvg(seed: string, animated: boolean) {
  const response = await fetch(buildDiceBearUrl(seed, animated), {
    headers: { Accept: "image/svg+xml" },
    signal: AbortSignal.timeout(DICEBEAR_TIMEOUT_MS)
  });
  if (!response.ok) {
    return null;
  }

  const body = (await response.text()).trim();
  if (!body.startsWith("<svg") || body.length > MAX_AVATAR_SVG_LENGTH) {
    return null;
  }
  return animated
    ? wrapAvatarEyes(stripAvatarAnimationStyle(applyAvatarViewBox(body)))
    : stripAvatarAnimationStyle(applyAvatarViewBox(body));
}

export async function ensureBotAvatarSvg(seed: string, animated = false) {
  const variant = animated ? "animated" : "static";
  const db = getDb();
  const stored = db
    .prepare("SELECT svg FROM bot_avatars WHERE seed = ? AND style = ? AND variant = ?")
    .get(seed, AVATAR_ART, variant) as { svg: string } | undefined;
  if (stored) {
    return stored.svg;
  }

  let svg: string | null = null;
  try {
    svg = await fetchBotAvatarSvg(seed, animated);
  } catch {
    return null;
  }
  if (!svg) {
    return null;
  }

  db.prepare(
    "INSERT OR REPLACE INTO bot_avatars (seed, style, variant, svg, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(seed, AVATAR_ART, variant, svg, new Date().toISOString());
  return svg;
}

export function deleteBotAvatarSvg(seed: string) {
  getDb()
    .prepare("DELETE FROM bot_avatars WHERE seed = ? AND style = ?")
    .run(seed, AVATAR_ART);
}
