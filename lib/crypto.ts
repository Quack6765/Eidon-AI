import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const V2_ITERATIONS = 600_000;
const V2_SALT_BYTES = 16;
const V2_KEY_LENGTH = 32;

function getV1Key() {
  return createHash("sha256").update(env.EIDON_ENCRYPTION_SECRET).digest();
}

function getV2Key(salt: Buffer) {
  return pbkdf2Sync(env.EIDON_ENCRYPTION_SECRET, salt, V2_ITERATIONS, V2_KEY_LENGTH, "sha512");
}

export function encryptValue(value: string) {
  if (!value) {
    return "";
  }

  const salt = randomBytes(V2_SALT_BYTES);
  const iv = randomBytes(12);
  const key = getV2Key(salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v2|${salt.toString("base64")}|${iv.toString("base64")}|${authTag.toString("base64")}|${encrypted.toString("base64")}`;
}

export function decryptValue(value: string) {
  if (!value) {
    return "";
  }

  const parts = value.split("|");

  if (parts[0] === "v2") {
    const [, saltPart, ivPart, authTagPart, encryptedPart] = parts;
    if (!saltPart || !ivPart || !authTagPart || !encryptedPart) {
      throw new Error("Invalid v2 encrypted payload");
    }

    const salt = Buffer.from(saltPart, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getV2Key(salt),
      Buffer.from(ivPart, "base64")
    );
    decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }

  // Legacy v1 format: iv.authTag.ciphertext (dot-separated, 3 parts)
  const [ivPart, authTagPart, encryptedPart] = parts[0].split(".");
  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("Invalid encrypted payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getV1Key(),
    Buffer.from(ivPart, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
