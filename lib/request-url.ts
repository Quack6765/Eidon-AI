export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp-servers/oauth/callback";

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

export function getMcpOAuthCallbackUrl(request: Request): string {
  return `${getRequestOrigin(request)}${MCP_OAUTH_CALLBACK_PATH}`;
}
