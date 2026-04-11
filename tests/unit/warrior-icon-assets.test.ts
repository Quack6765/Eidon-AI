import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { generateWarriorIconAssets } from "@/lib/warrior-icon-assets";

describe("generateWarriorIconAssets", () => {
  it("creates warrior icon assets from the banner source", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "warrior-icons-"));
    const sourcePath = path.resolve(process.cwd(), "public/eidon-banner.png");

    await generateWarriorIconAssets({
      sourcePath,
      outputDir: tempDir
    });

    await expect(sharp(path.join(tempDir, "warrior-portrait.png")).metadata()).resolves.toMatchObject({
      width: 512,
      height: 512
    });
    await expect(sharp(path.join(tempDir, "agent-icon.png")).metadata()).resolves.toMatchObject({
      width: 128,
      height: 128
    });
    await expect(sharp(path.join(tempDir, "icon-192.png")).metadata()).resolves.toMatchObject({
      width: 192,
      height: 192
    });
    await expect(sharp(path.join(tempDir, "icon-512.png")).metadata()).resolves.toMatchObject({
      width: 512,
      height: 512
    });
    await expect(
      sharp(path.join(tempDir, "apple-touch-icon.png")).metadata()
    ).resolves.toMatchObject({
      width: 180,
      height: 180
    });

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
