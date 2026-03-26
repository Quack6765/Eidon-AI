import { decryptValue, encryptValue } from "@/lib/crypto";

describe("crypto helpers", () => {
  it("encrypts and decrypts values without losing data", () => {
    const secret = "sk-test-secret";
    const encrypted = encryptValue(secret);

    expect(encrypted).not.toBe(secret);
    expect(decryptValue(encrypted)).toBe(secret);
  });

  it("returns an empty string for empty values", () => {
    expect(encryptValue("")).toBe("");
    expect(decryptValue("")).toBe("");
  });
});
