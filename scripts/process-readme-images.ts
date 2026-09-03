import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

const SCREENSHOT_DIR = path.resolve(".github/readme");
const HERO_PANELS = ["desktop-chat.png", "desktop-delegation.png", "desktop-automations.png"];
const HERO_OUTPUT = "hero.png";
const HERO_GUTTER = 16;
const HERO_BACKGROUND = { r: 10, g: 10, b: 10, alpha: 1 };
const MAX_BYTES = 300 * 1024;

async function composeHero() {
  const panels = HERO_PANELS.map((name) => path.join(SCREENSHOT_DIR, name));
  const missing = panels.filter((panel) => !fs.existsSync(panel));

  if (missing.length > 0) {
    throw new Error(
      `Cannot compose the hero, missing panels: ${missing.map((panel) => path.basename(panel)).join(", ")}`
    );
  }

  const metadata = await Promise.all(panels.map((panel) => sharp(panel).metadata()));
  const heights = metadata.map((meta) => meta.height ?? 0);
  const widths = metadata.map((meta) => meta.width ?? 0);

  if (heights.some((height) => height === 0) || widths.some((width) => width === 0)) {
    throw new Error("Cannot compose the hero, a panel has no dimensions");
  }

  const height = Math.max(...heights);
  const width = widths.reduce((sum, panelWidth) => sum + panelWidth, 0) + HERO_GUTTER * (panels.length - 1);

  let left = 0;
  const composites = panels.map((panel, index) => {
    const composite = { input: panel, left, top: 0 };
    left += widths[index] + HERO_GUTTER;
    return composite;
  });

  const output = path.join(SCREENSHOT_DIR, HERO_OUTPUT);
  await sharp({
    create: { width, height, channels: 4, background: HERO_BACKGROUND }
  })
    .composite(composites)
    .png()
    .toFile(output);

  console.log(`  composed ${HERO_OUTPUT} (${width}x${height}) from ${panels.length} panels`);
  return output;
}

async function compress(file: string) {
  const before = fs.statSync(file).size;
  const buffer = await sharp(file).png({ compressionLevel: 9, palette: true }).toBuffer();

  // Only keep the recompressed version when it actually helps.
  if (buffer.byteLength < before) {
    fs.writeFileSync(file, buffer);
  }

  const after = fs.statSync(file).size;
  const flag = after > MAX_BYTES ? "  <-- over budget" : "";
  console.log(
    `  ${path.basename(file).padEnd(28)} ${(before / 1024).toFixed(0).padStart(5)}KB -> ${(after / 1024).toFixed(0).padStart(5)}KB${flag}`
  );

  return after;
}

async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    throw new Error(`Screenshot directory not found: ${SCREENSHOT_DIR}`);
  }

  console.log("==> Composing hero...");
  await composeHero();

  console.log("==> Compressing images...");
  const files = fs
    .readdirSync(SCREENSHOT_DIR)
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => path.join(SCREENSHOT_DIR, name));

  const sizes = await Promise.all(files.map((file) => compress(file)));
  const oversized = files.filter((_, index) => sizes[index] > MAX_BYTES);
  const total = sizes.reduce((sum, size) => sum + size, 0);

  console.log(`==> ${files.length} images, ${(total / 1024 / 1024).toFixed(2)}MB total`);

  if (oversized.length > 0) {
    console.warn(
      `WARNING: ${oversized.length} image(s) over ${MAX_BYTES / 1024}KB: ${oversized
        .map((file) => path.basename(file))
        .join(", ")}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown image processing failure");
  process.exitCode = 1;
});
