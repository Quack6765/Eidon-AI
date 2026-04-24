export function createId(prefix: string) {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("crypto.randomUUID() is required but not available");
  }
  return `${prefix}_${crypto.randomUUID()}`;
}
