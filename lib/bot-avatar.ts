export function buildBotAvatarUrl(seed: string) {
  return `/api/avatars/${encodeURIComponent(seed)}.svg`;
}
