import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

const SCREENSHOT_DIR = path.resolve(".github/readme");
const MAX_BYTES = 300 * 1024;

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
