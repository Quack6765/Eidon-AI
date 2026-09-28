import { lookup } from "node:dns/promises";
import http from "node:http";
import net from "node:net";

const REGISTRY_KEY = Symbol.for("eidon.egress-proxy");
const CONNECT_TIMEOUT_MS = 15_000;
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
];

const BLOCKED_RANGES: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"]
];

const blockedAddresses = new net.BlockList();
for (const [address, prefix, family] of BLOCKED_RANGES) blockedAddresses.addSubnet(address, prefix, family);

export function isBlockedAddress(address: string) {
  const family = net.isIP(address);
  if (!family) return true;
  return blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

type Registry = { proxy: Promise<number> | null; server: http.Server | null };

function getRegistry() {
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  scope[REGISTRY_KEY] ??= { proxy: null, server: null };
  return scope[REGISTRY_KEY];
}

function blockedMessage(host: string) {
  return `Eidon blocked this request: ${host} is on a private or local network.`;
}

async function resolvePublicAddress(host: string, isBlocked: (address: string) => boolean) {
  const hostname = host.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => isBlocked(address))) return null;
  return addresses[0].address;
}

function forwardHeaders(headers: http.IncomingHttpHeaders) {
  const forwarded = { ...headers };
  for (const name of HOP_BY_HOP_HEADERS) delete forwarded[name];
  return forwarded;
}

export function createEgressProxy(isBlocked: (address: string) => boolean = isBlockedAddress) {
  const server = http.createServer(async (request, response) => {
    let target: URL;
    try {
      target = new URL(request.url ?? "");
    } catch {
      response.writeHead(400).end("Eidon's proxy only accepts absolute http:// URLs.");
      return;
    }
    if (target.protocol !== "http:") {
      response.writeHead(400).end("Eidon's proxy only accepts absolute http:// URLs.");
      return;
    }
    const address = await resolvePublicAddress(target.hostname, isBlocked);
    if (!address) {
      response.writeHead(403).end(blockedMessage(target.hostname));
      return;
    }
    const upstream = http.request(
      {
        host: address,
        port: target.port || 80,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...forwardHeaders(request.headers), host: target.host },
        timeout: CONNECT_TIMEOUT_MS
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, forwardHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      }
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });

  server.on("connect", async (request: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    client.on("error", () => client.destroy());
    const authority = /^(\[[^\]]+\]|[^:\s]+):(\d{1,5})$/.exec(request.url ?? "");
    const port = Number(authority?.[2]);
    if (!authority || !port || port > 65_535) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const address = await resolvePublicAddress(authority[1], isBlocked);
    if (!address) {
      client.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n${blockedMessage(authority[1])}`);
      return;
    }
    const upstream = net.connect({ host: address, port, timeout: CONNECT_TIMEOUT_MS }, () => {
      upstream.setTimeout(0);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    client.on("close", () => upstream.destroy());
  });

  return server;
}

export function ensureEgressProxy() {
  const registry = getRegistry();
  registry.proxy ??= new Promise<number>((resolve, reject) => {
    const server = createEgressProxy();
    server.once("error", (error) => {
      registry.proxy = null;
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      registry.server = server;
      resolve((server.address() as net.AddressInfo).port);
    });
  });
  return registry.proxy;
}

export function egressProxyEnv(port: number) {
  const url = `http://127.0.0.1:${port}`;
  return { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, NODE_USE_ENV_PROXY: "1" };
}

export async function stopEgressProxy() {
  const registry = getRegistry();
  const server = registry.server;
  registry.proxy = null;
  registry.server = null;
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
