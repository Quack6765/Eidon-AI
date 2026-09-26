const REGISTRY_KEY = Symbol.for("eidon.secret-redaction");
const SECRET_LIFETIME_MS = 6 * 60 * 60_000;
const MIN_SECRET_CHARS = 3;
export const REDACTED_SECRET = "[hidden secret]";

type RememberedSecret = { patterns: string[]; expiresAt: number };

function getRegistry() {
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Map<string, RememberedSecret[]> };
  scope[REGISTRY_KEY] ??= new Map();
  return scope[REGISTRY_KEY];
}

function liveSecrets(conversationId: string, now = Date.now()) {
  const registry = getRegistry();
  const secrets = (registry.get(conversationId) ?? []).filter((secret) => secret.expiresAt > now);
  if (secrets.length) registry.set(conversationId, secrets);
  else registry.delete(conversationId);
  return secrets;
}

export function rememberSecretForRedaction(conversationId: string, value: string) {
  if (value.length < MIN_SECRET_CHARS) return;
  const patterns = [
    value,
    encodeURIComponent(value),
    Buffer.from(value, "utf8").toString("base64"),
    JSON.stringify(value).slice(1, -1)
  ];
  const secrets = liveSecrets(conversationId);
  secrets.push({
    patterns: [...new Set(patterns)].sort((left, right) => right.length - left.length),
    expiresAt: Date.now() + SECRET_LIFETIME_MS
  });
  getRegistry().set(conversationId, secrets);
}

export function redactSecrets(conversationId: string | undefined, text: string) {
  if (!conversationId || !text) return text;
  let redacted = text;
  for (const secret of liveSecrets(conversationId)) {
    for (const pattern of secret.patterns) redacted = redacted.split(pattern).join(REDACTED_SECRET);
  }
  return redacted;
}

export function resetSecretRedactionForTests() {
  getRegistry().clear();
}
