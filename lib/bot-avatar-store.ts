import { getDb } from "@/lib/db";

const DICEBEAR_BOTTTS_URL = "https://api.dicebear.com/10.x/bottts/svg";
const AVATAR_SOURCE_SIZE = 512;
const AVATAR_BASE_COLORS = [
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
const AVATAR_TEXTURE_VARIANTS = ["circuits", "dots"];
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

function buildDiceBearUrl(seed: string) {
  const hash = hashSeed(seed);
  const params = new URLSearchParams({
    seed,
    size: String(AVATAR_SOURCE_SIZE),
    baseColor: AVATAR_BASE_COLORS[hash % AVATAR_BASE_COLORS.length],
    textureVariant: AVATAR_TEXTURE_VARIANTS[(hash >>> 16) % AVATAR_TEXTURE_VARIANTS.length]
  });
  return `${DICEBEAR_BOTTTS_URL}?${params.toString()}`;
}

async function fetchBotAvatarSvg(seed: string) {
  const response = await fetch(buildDiceBearUrl(seed), {
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
  return body;
}

export async function ensureBotAvatarSvg(seed: string) {
  const db = getDb();
  const stored = db
    .prepare("SELECT svg FROM bot_avatars WHERE seed = ?")
    .get(seed) as { svg: string } | undefined;
  if (stored) {
    return stored.svg;
  }

  let svg: string | null = null;
  try {
    svg = await fetchBotAvatarSvg(seed);
  } catch {
    return null;
  }
  if (!svg) {
    return null;
  }

  db.prepare("INSERT OR REPLACE INTO bot_avatars (seed, svg, created_at) VALUES (?, ?, ?)").run(
    seed,
    svg,
    new Date().toISOString()
  );
  return svg;
}

export function deleteBotAvatarSvg(seed: string) {
  getDb().prepare("DELETE FROM bot_avatars WHERE seed = ?").run(seed);
}
