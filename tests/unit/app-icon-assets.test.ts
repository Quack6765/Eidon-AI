import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { generateAppIconAssets } from "@/lib/app-icon-assets";

describe("generateAppIconAssets", () => {
  it("creates only the live icon assets from the violet bot source", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "app-icons-"));
    const sourcePath = path.resolve(process.cwd(), "public/bots/bot-violet.svg");

    try {
      await generateAppIconAssets({
        sourcePath,
        outputDir: tempDir
      });

      await expect(fs.readdir(tempDir)).resolves.toEqual([
        "agent-icon.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png"
      ]);
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

      const expectedAgentIcon = await sharp(sourcePath, { density: 384 })
        .resize(128, 128, { fit: "fill" })
        .png()
        .raw()
        .toBuffer();
      const actualAgentIcon = await sharp(path.join(tempDir, "agent-icon.png"))
        .png()
        .raw()
        .toBuffer();

      expect(actualAgentIcon.equals(expectedAgentIcon)).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
