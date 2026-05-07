import { SignJWT } from "jose";

import { verifyHs256Jwt } from "@/lib/edge-session-token";

const secret = new TextEncoder().encode("edge-session-token-test-secret");

async function signSessionToken(
  payload: Record<string, unknown>,
  options: { expiresAt?: number; secretOverride?: Uint8Array } = {}
) {
  const signer = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });

  if (options.expiresAt !== undefined) {
    signer.setExpirationTime(options.expiresAt);
  } else {
    signer.setExpirationTime(Math.floor(Date.now() / 1000) + 60);
  }

  return signer.sign(options.secretOverride ?? secret);
}

describe("edge session token verifier", () => {
  it("verifies a signed HS256 token and returns its payload", async () => {
    const token = await signSessionToken({ sid: "session_123", uid: "user_123" });

    await expect(verifyHs256Jwt(token, secret)).resolves.toMatchObject({
      sid: "session_123",
      uid: "user_123"
    });
  });

  it("rejects invalid signatures and expired tokens", async () => {
    const badSignatureToken = await signSessionToken(
      { sid: "session_123", uid: "user_123" },
      { secretOverride: new TextEncoder().encode("wrong-secret") }
    );
    const expiredToken = await signSessionToken(
      { sid: "session_123", uid: "user_123" },
      { expiresAt: Math.floor(Date.now() / 1000) - 1 }
    );

    await expect(verifyHs256Jwt(badSignatureToken, secret)).resolves.toBeNull();
    await expect(verifyHs256Jwt(expiredToken, secret)).resolves.toBeNull();
    await expect(verifyHs256Jwt("not-a-jwt", secret)).resolves.toBeNull();
  });
});
