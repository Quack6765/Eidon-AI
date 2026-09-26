import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REDACTED_SECRET,
  redactSecrets,
  rememberSecretForRedaction,
  resetSecretRedactionForTests
} from "@/lib/secret-redaction";

describe("secret redaction", () => {
  afterEach(() => {
    resetSecretRedactionForTests();
    vi.useRealTimers();
  });

  it("hides a filled secret and its encoded forms, only in its own conversation", () => {
    const secret = 'p@ss w0rd/"x"';
    rememberSecretForRedaction("conv_a", secret);
    const text = [
      `value=${secret}`,
      `url=${encodeURIComponent(secret)}`,
      `b64=${Buffer.from(secret).toString("base64")}`,
      `json=${JSON.stringify({ secret })}`
    ].join("\n");

    const redacted = redactSecrets("conv_a", text);

    expect(redacted).not.toContain("w0rd");
    expect(redacted).not.toContain(Buffer.from(secret).toString("base64"));
    expect(redacted.split(REDACTED_SECRET)).toHaveLength(5);
    expect(redactSecrets("conv_b", text)).toBe(text);
    expect(redactSecrets(undefined, text)).toBe(text);
    expect(redactSecrets("conv_a", "")).toBe("");
  });

  it("ignores values too short to hide safely and forgets secrets after a few hours", () => {
    vi.useFakeTimers();
    rememberSecretForRedaction("conv_a", "42");
    rememberSecretForRedaction("conv_a", "123456");
    expect(redactSecrets("conv_a", "42 then 123456")).toBe(`42 then ${REDACTED_SECRET}`);

    vi.advanceTimersByTime(7 * 60 * 60_000);
    expect(redactSecrets("conv_a", "123456")).toBe("123456");
  });
});
