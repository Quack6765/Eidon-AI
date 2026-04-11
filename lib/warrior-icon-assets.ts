import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

export type WarriorIconAssetInput = {
  sourcePath: string;
  outputDir: string;
};

const ASSET_SPECS = [
  { filename: "warrior-portrait.png", size: 512 },
  { filename: "agent-icon.png", size: 128 },
  { filename: "icon-192.png", size: 192 },
  { filename: "icon-512.png", size: 512 },
  { filename: "apple-touch-icon.png", size: 180 }
] as const;

export async function generateWarriorIconAssets(input: WarriorIconAssetInput) {
  const metadata = await sharp(input.sourcePath).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to read image dimensions from ${input.sourcePath}`);
  }

  const cropSize = Math.min(metadata.width, metadata.height);
  const left = Math.floor((metadata.width - cropSize) / 2);
  const top = Math.floor((metadata.height - cropSize) / 2);

  await fs.mkdir(input.outputDir, { recursive: true });

  const cropBuffer = await sharp(input.sourcePath)
    .extract({
      left,
      top,
      width: cropSize,
      height: cropSize
    })
    .png()
    .toBuffer();

  for (const asset of ASSET_SPECS) {
    await sharp(cropBuffer)
      .resize(asset.size, asset.size, { fit: "fill" })
      .png()
      .toFile(path.join(input.outputDir, asset.filename));
  }
}
