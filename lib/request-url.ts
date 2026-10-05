import { env, hasHttpScheme } from "@/lib/env";

export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp-servers/oauth/callback";

export function getExternalBaseUrl(): string | null {
  const base = env.EIDON_BASE_URL?.trim();
  if (!base) {
    return null;
  }
  const normalized = base.replace(/\/+$/, "");
  return hasHttpScheme(normalized) ? normalized : null;
}

export function getRequestOrigin(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (host) {
    const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "");
    return `${protocol}://${host}`;
  }
  return new URL(request.url).origin;
}

export function resolveExternalOrigin(request: Request): string {
  return getExternalBaseUrl() ?? getRequestOrigin(request);
}

export function getMcpOAuthCallbackUrl(request: Request): string {
  return `${resolveExternalOrigin(request)}${MCP_OAUTH_CALLBACK_PATH}`;
}
