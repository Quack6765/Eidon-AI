import fs from "node:fs";
import path from "node:path";

import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { tokenizeShellCommand } from "@/lib/shell-tokenizer";

const SCREENSHOT_CAPABILITY_REGISTRY_KEY = Symbol.for("eidon:screenshot-artifact-capabilities");
const SCREENSHOT_CAPABILITY_TTL_MS = 5 * 60_000;
const MAX_SCREENSHOT_CAPABILITIES = 100;

type ScreenshotArtifactCandidate = {
  sourcePath: string;
};

export type VerifiedScreenshotArtifact = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

type ScreenshotArtifactCapability = {
  artifact: VerifiedScreenshotArtifact;
  expiresAt: number;
};

function getCapabilityRegistry() {
  const globalRegistry = globalThis as Record<
    symbol,
    Map<string, ScreenshotArtifactCapability> | undefined
  >;
  let registry = globalRegistry[SCREENSHOT_CAPABILITY_REGISTRY_KEY];

  if (!registry) {
    registry = new Map<string, ScreenshotArtifactCapability>();
    globalRegistry[SCREENSHOT_CAPABILITY_REGISTRY_KEY] = registry;
  }

  return registry;
}

function pruneCapabilities() {
  const registry = getCapabilityRegistry();
  const now = Date.now();

  for (const [handle, capability] of registry) {
    if (capability.expiresAt <= now) {
      registry.delete(handle);
    }
  }

  while (registry.size >= MAX_SCREENSHOT_CAPABILITIES) {
    const oldestHandle = registry.keys().next().value;
    if (typeof oldestHandle !== "string") {
      break;
    }
    registry.delete(oldestHandle);
  }
}

function parseStandaloneScreenshotPath(command: string) {
  if (/[$`<>\r\n]/.test(command)) {
    return null;
  }

  const tokens = tokenizeShellCommand(command);

  if (
    tokens.length < 3 ||
    tokens[0] !== "agent-browser" ||
    (tokens[1] ?? "").toLowerCase() !== "screenshot"
  ) {
    return null;
  }

  const sourcePath = tokens[2] ?? "";
  if (!path.isAbsolute(sourcePath)) {
    return null;
  }

  if (tokens.slice(3).some((token) => !token.startsWith("-"))) {
    return null;
  }

  return path.normalize(sourcePath);
}

export function prepareScreenshotArtifact(command: string): ScreenshotArtifactCandidate | null {
  const sourcePath = parseStandaloneScreenshotPath(command);
  if (!sourcePath) {
    return null;
  }

  try {
    fs.lstatSync(sourcePath);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return null;
    }
  }

  return { sourcePath };
}

function getVerifiedImageType(filename: string, bytes: Buffer) {
  const extension = path.extname(filename).toLowerCase();
  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const gifHeader = bytes.subarray(0, 6).toString("ascii");
  const isGif = gifHeader === "GIF87a" || gifHeader === "GIF89a";
  const isWebp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if (extension === ".png" && isPng) return "image/png";
  if ((extension === ".jpg" || extension === ".jpeg") && isJpeg) return "image/jpeg";
  if (extension === ".gif" && isGif) return "image/gif";
  if (extension === ".webp" && isWebp) return "image/webp";
  return null;
}

function readVerifiedScreenshot(candidate: ScreenshotArtifactCandidate) {
  let fileDescriptor: number | null = null;

  try {
    const pathStats = fs.lstatSync(candidate.sourcePath);
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
      return null;
    }

    fileDescriptor = fs.openSync(
      candidate.sourcePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const stats = fs.fstatSync(fileDescriptor);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_ATTACHMENT_BYTES) {
      return null;
    }

    const bytes = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const bytesRead = fs.readSync(fileDescriptor, bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) {
        return null;
      }
      offset += bytesRead;
    }

    const filename = path.basename(candidate.sourcePath);
    const mimeType = getVerifiedImageType(filename, bytes);
    if (!mimeType) {
      return null;
    }

    return { filename, mimeType, bytes };
  } catch {
    return null;
  } finally {
    if (fileDescriptor !== null) {
      fs.closeSync(fileDescriptor);
    }
  }
}

export function registerScreenshotArtifact(
  actionHandle: string | undefined,
  candidate: ScreenshotArtifactCandidate | null
) {
  if (!actionHandle || !candidate) {
    return false;
  }

  const artifact = readVerifiedScreenshot(candidate);
  if (!artifact) {
    return false;
  }

  pruneCapabilities();
  getCapabilityRegistry().set(actionHandle, {
    artifact,
    expiresAt: Date.now() + SCREENSHOT_CAPABILITY_TTL_MS
  });
  return true;
}

export function consumeScreenshotArtifact(actionHandle: string) {
  pruneCapabilities();
  const registry = getCapabilityRegistry();
  const capability = registry.get(actionHandle);
  registry.delete(actionHandle);
  return capability?.artifact ?? null;
}

export function revokeScreenshotArtifact(actionHandle: string | undefined) {
  if (actionHandle) {
    getCapabilityRegistry().delete(actionHandle);
  }
}
