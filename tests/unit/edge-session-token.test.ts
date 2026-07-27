import { SignJWT } from "jose";

import { verifyHs256Jwt, verifyHs256SessionJwt } from "@/lib/edge-session-token";

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

  it("requires the session token domain and concrete session claims", async () => {
    const valid = await new SignJWT({
      sid: "session_123",
      uid: "user_123",
      tokenUse: "session"
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("eidon")
      .setAudience("eidon-session")
      .setExpirationTime("1m")
      .sign(secret);
    const oauthState = await new SignJWT({
      profileId: "profile_123",
      userId: "user_123",
      tokenUse: "github_oauth_state"
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("eidon")
      .setAudience("eidon-github-oauth")
      .setExpirationTime("1m")
      .sign(secret);

    const expected = {
      issuer: "eidon",
      audience: "eidon-session",
      tokenUse: "session"
    };

    await expect(verifyHs256SessionJwt(valid, secret, expected)).resolves.toMatchObject({
      sid: "session_123",
      uid: "user_123"
    });
    await expect(verifyHs256SessionJwt(oauthState, secret, expected)).resolves.toBeNull();
  });
});
