import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { env } from "@/lib/env";

describe("crypto helpers", () => {
  it("encrypts and decrypts values without losing data", () => {
    const secret = "sk-test-secret";
    const encrypted = encryptValue(secret);

    expect(encrypted).not.toBe(secret);
    expect(encrypted).toMatch(/^v2\|/);
    expect(decryptValue(encrypted)).toBe(secret);
  });

  it("returns an empty string for empty values", () => {
    expect(encryptValue("")).toBe("");
    expect(decryptValue("")).toBe("");
  });

  it("decrypts legacy v1 format (SHA-256 key derivation)", () => {
    const encryptionSecret = env.EIDON_ENCRYPTION_SECRET;
    const iv = randomBytes(12);
    const key = createHash("sha256").update(encryptionSecret).digest();
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const v1Payload = [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");

    expect(decryptValue(v1Payload)).toBe("legacy-secret");
  });
});
