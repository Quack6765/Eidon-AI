const AVATAR_GRID_SIZE = 5;
const AVATAR_PALETTE = [
  "#2496ed",
  "#0ea5e9",
  "#14b8a6",
  "#10b981",
  "#f59e0b",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#6366f1",
  "#6d28d9"
];

function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mixHash(hash: number) {
  let next = hash;
  next ^= next << 13;
  next >>>= 0;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return next;
}

export function buildBotAvatarSvg(seed: string, size = 64) {
  const grid: boolean[][] = Array.from({ length: AVATAR_GRID_SIZE }, () =>
    Array.from({ length: AVATAR_GRID_SIZE }, () => false)
  );

  let hash = hashSeed(seed);
  hash = mixHash(hash);
  const color = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];

  for (let x = 0; x < Math.ceil(AVATAR_GRID_SIZE / 2); x += 1) {
    for (let y = 0; y < AVATAR_GRID_SIZE; y += 1) {
      hash = mixHash(hash);
      const filled = (hash & 1) === 1;
      grid[y][x] = filled;
      grid[y][AVATAR_GRID_SIZE - 1 - x] = filled;
    }
  }

  const cell = size / AVATAR_GRID_SIZE;
  const cells = grid
    .flatMap((row, y) =>
      row.map((filled, x) =>
        filled
          ? `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${(cell / 4).toFixed(2)}"/>`
          : ""
      )
    )
    .filter(Boolean)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${(size / 5).toFixed(2)}" fill="currentColor" fill-opacity="0.08"/><g fill="${color}">${cells}</g></svg>`;
}

export function buildBotAvatarDataUrl(seed: string, size = 64) {
  const svg = buildBotAvatarSvg(seed, size);
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

export function buildBotAvatarColor(seed: string) {
  const hash = mixHash(hashSeed(seed));
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
