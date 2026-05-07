const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return null;
  }

  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);

  try {
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
}

function parseJsonSegment(value: string) {
  const decoded = base64UrlDecode(value);

  if (!decoded) {
    return null;
  }

  try {
    return JSON.parse(decoder.decode(decoded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasValidTemporalClaims(payload: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === "number" && payload.exp <= now) {
    return false;
  }

  if (typeof payload.nbf === "number" && payload.nbf > now) {
    return false;
  }

  return true;
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function verifyHs256Jwt(token: string, secret: Uint8Array) {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split(".");

  if (!encodedHeader || !encodedPayload || !encodedSignature || extra !== undefined) {
    return null;
  }

  const header = parseJsonSegment(encodedHeader);
  const payload = parseJsonSegment(encodedPayload);
  const signature = base64UrlDecode(encodedSignature);

  if (!header || !payload || !signature || header.alg !== "HS256") {
    return null;
  }

  if (!hasValidTemporalClaims(payload)) {
    return null;
  }

  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      copyToArrayBuffer(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const verified = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );

    return verified ? payload : null;
  } catch {
    return null;
  }
}
