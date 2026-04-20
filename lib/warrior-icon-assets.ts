import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

export type WarriorIconAssetInput = {
  sourcePath: string;
  outputDir: string;
};

const ASSET_SPECS = [
  { filename: "agent-icon.png", size: 128 },
  { filename: "icon-192.png", size: 192 },
  { filename: "icon-512.png", size: 512 },
  { filename: "apple-touch-icon.png", size: 180 }
] as const;

const WARRIOR_ICON_CROP = {
  left: 332,
  top: 8,
  width: 360,
  height: 360
} as const;

export async function generateWarriorIconAssets(input: WarriorIconAssetInput) {
  await fs.mkdir(input.outputDir, { recursive: true });

  const cropBuffer = await sharp(input.sourcePath)
    .extract(WARRIOR_ICON_CROP)
    .png()
    .toBuffer();

  for (const asset of ASSET_SPECS) {
    await sharp(cropBuffer)
      .resize(asset.size, asset.size, { fit: "fill" })
      .png()
      .toFile(path.join(input.outputDir, asset.filename));
  }
}
