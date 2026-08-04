import fs from "node:fs";

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EINVAL",
  "ENOTSUP",
  "EISDIR",
  "EBADF",
  "EPERM"
]);

export function syncDirectory(directory: string) {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (!UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code)) throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}
