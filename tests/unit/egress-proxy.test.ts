import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEgressProxy,
  egressProxyEnv,
  ensureEgressProxy,
  isBlockedAddress,
  stopEgressProxy
} from "@/lib/egress-proxy";

const servers: net.Server[] = [];

function listen<T extends net.Server>(server: T) {
  servers.push(server);
  return new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
}

function proxyGet(proxyPort: number, url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers }, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }));
    });
    request.on("error", reject);
    request.end();
  });
}

function proxyConnect(proxyPort: number, authority: string, payload?: string) {
  return new Promise<string>((resolve) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
      if (payload) setTimeout(() => socket.write(payload), 50);
    });
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString();
      if (!payload || received.includes("echo:")) socket.end();
    });
    socket.on("close", () => resolve(received));
    socket.on("error", () => resolve(received));
  });
}

describe("egress proxy", () => {
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      (server as http.Server).closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await stopEgressProxy();
  });

  it("blocks loopback, private, link-local, metadata and other internal addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.5",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.0.1",
      "64:ff9b::a00:1",
      "not-an-ip"
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("refuses requests for this server and the local network, by address or by name", async () => {
    const proxyPort = await listen(createEgressProxy());

    const byAddress = await proxyGet(proxyPort, "http://127.0.0.1:3000/api/settings");
    expect(byAddress.status).toBe(403);
    expect(byAddress.body).toContain("127.0.0.1 is on a private or local network");
    expect((await proxyGet(proxyPort, "http://localhost:3000/")).status).toBe(403);
    expect((await proxyGet(proxyPort, "http://[::1]:3000/")).status).toBe(403);
    expect((await proxyGet(proxyPort, "/relative")).status).toBe(400);
    expect((await proxyGet(proxyPort, "https://example.com/")).status).toBe(400);

    expect(await proxyConnect(proxyPort, "localhost:443")).toContain("403 Forbidden");
    expect(await proxyConnect(proxyPort, "169.254.169.254:80")).toContain("403 Forbidden");
    expect(await proxyConnect(proxyPort, "example.com")).toContain("400 Bad Request");
  });

  it("forwards allowed requests and tunnels, without leaking proxy headers", async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const target = http.createServer((request, response) => {
      seen.push(request.headers);
      response.setHeader("Connection", "close");
      response.end(`hello ${request.url}`);
    });
    const targetPort = await listen(target);
    const echo = net.createServer((socket) => socket.on("data", (chunk) => socket.write(`echo:${chunk}`)));
    const echoPort = await listen(echo);
    const proxyPort = await listen(createEgressProxy((address) => address === "10.0.0.1"));

    const response = await proxyGet(proxyPort, `http://127.0.0.1:${targetPort}/page?q=1`, {
      "Proxy-Authorization": "Basic c2VjcmV0",
      "Proxy-Connection": "keep-alive"
    });
    expect(response.status).toBe(200);
    expect(response.body).toBe("hello /page?q=1");
    expect(seen[0].host).toBe(`127.0.0.1:${targetPort}`);
    expect(seen[0]).not.toHaveProperty("proxy-authorization");
    expect(seen[0]).not.toHaveProperty("proxy-connection");

    const tunnel = await proxyConnect(proxyPort, `127.0.0.1:${echoPort}`, "ping");
    expect(tunnel).toContain("200 Connection Established");
    expect(tunnel).toContain("echo:ping");

    expect((await proxyGet(proxyPort, "http://127.0.0.1:1/")).status).toBe(502);
    expect(await proxyConnect(proxyPort, "127.0.0.1:1")).toContain("502 Bad Gateway");
    expect((await proxyGet(proxyPort, "http://no-such-host.invalid/")).status).toBe(403);
  });

  it("runs one shared proxy for the whole server and hands shells its address", async () => {
    const first = await ensureEgressProxy();
    const second = await ensureEgressProxy();

    expect(second).toBe(first);
    expect(egressProxyEnv(first)).toEqual({
      HTTP_PROXY: `http://127.0.0.1:${first}`,
      HTTPS_PROXY: `http://127.0.0.1:${first}`,
      http_proxy: `http://127.0.0.1:${first}`,
      https_proxy: `http://127.0.0.1:${first}`,
      NODE_USE_ENV_PROXY: "1"
    });
    expect((await proxyGet(first, "http://127.0.0.1:3000/")).status).toBe(403);

    await stopEgressProxy();
    expect(await ensureEgressProxy()).not.toBe(0);
  });
});
