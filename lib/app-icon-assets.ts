import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

export type AppIconAssetInput = {
  sourcePath: string;
  outputDir: string;
};

const ASSET_SPECS = [
  { filename: "agent-icon.png", size: 128 },
  { filename: "icon-192.png", size: 192 },
  { filename: "icon-512.png", size: 512 },
  { filename: "apple-touch-icon.png", size: 180 }
] as const;

const SVG_RENDER_DENSITY = 384;

export async function generateAppIconAssets(input: AppIconAssetInput) {
  await fs.mkdir(input.outputDir, { recursive: true });

  for (const asset of ASSET_SPECS) {
    await sharp(input.sourcePath, { density: SVG_RENDER_DENSITY })
      .resize(asset.size, asset.size, { fit: "fill" })
      .png()
      .toFile(path.join(input.outputDir, asset.filename));
  }
}
