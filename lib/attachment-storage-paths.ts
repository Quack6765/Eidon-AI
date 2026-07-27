import fs from "node:fs";
import path from "node:path";

function isMissingPathError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function assertDirectory(directory: string) {
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Attachment storage contains an unsafe directory link");
  }
}

export function getAttachmentStorageRoot(dataDir: string, create: boolean) {
  const requestedRoot = path.resolve(dataDir, "attachments");

  if (create) {
    fs.mkdirSync(requestedRoot, { recursive: true });
  } else if (!fs.existsSync(requestedRoot)) {
    return null;
  }

  assertDirectory(requestedRoot);
  return fs.realpathSync(requestedRoot);
}

function relativeInsideRoot(root: string, absolutePath: string) {
  const relativePath = path.relative(root, absolutePath);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Attachment artifact path escapes the attachment root");
  }
  return relativePath;
}

export function resolveAttachmentStoragePath(root: string, relativePath: string) {
  const absolutePath = path.resolve(root, relativePath);
  relativeInsideRoot(root, absolutePath);
  return absolutePath;
}

export function assertSafeAttachmentDirectory(
  root: string,
  directory: string,
  create: boolean
) {
  const absoluteDirectory = path.resolve(directory);
  const relativeDirectory = path.relative(root, absoluteDirectory);

  if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
    throw new Error("Attachment directory escapes the attachment root");
  }

  let currentDirectory = root;
  assertDirectory(currentDirectory);

  for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
    currentDirectory = path.join(currentDirectory, segment);
    try {
      assertDirectory(currentDirectory);
    } catch (error) {
      if (!create || !isMissingPathError(error)) {
        throw error;
      }
      try {
        fs.mkdirSync(currentDirectory, { mode: 0o700 });
      } catch (mkdirError) {
        if (!(mkdirError instanceof Error) || !("code" in mkdirError) || mkdirError.code !== "EEXIST") {
          throw mkdirError;
        }
      }
      assertDirectory(currentDirectory);
    }
  }

  if (fs.realpathSync(absoluteDirectory) !== absoluteDirectory) {
    throw new Error("Attachment directory resolves outside managed storage");
  }
}

export function resolveSafeAttachmentFilePath(
  root: string,
  relativePath: string,
  createParentDirectories: boolean
) {
  const absolutePath = resolveAttachmentStoragePath(root, relativePath);
  assertSafeAttachmentDirectory(root, path.dirname(absolutePath), createParentDirectories);
  return absolutePath;
}
