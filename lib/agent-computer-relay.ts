import { readFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import {
  botBrowserTarget,
  touchBrowserSession,
  userBrowserTarget,
  type BrowserSessionTarget
} from "@/lib/agent-computer";
import { getBotByConversationId } from "@/lib/bots";
import { getConversationOwnerId } from "@/lib/conversations";
import type { ComputerState } from "@/lib/types";

const REGISTRY_KEY = Symbol.for("eidon.agent-computer-relay");
const MAX_BUFFERED_BYTES = 256 * 1024;
const RECONNECT_MS = 2_000;
const TOUCH_INTERVAL_MS = 60_000;
const BROWSER_VIEWER_FPS = 15;
const MOBILE_VIEWER_FPS = 8;
const UPSTREAM_MAX_FPS = 15;

type Viewer = {
  socket: WebSocket;
  minIntervalMs: number;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type Channel = {
  target: BrowserSessionTarget;
  upstream: WebSocket | null;
  viewers: Set<Viewer>;
  frame: Buffer | null;
  state: ComputerState;
  reconnect: ReturnType<typeof setTimeout> | null;
  touch: ReturnType<typeof setInterval> | null;
};

type Registry = {
  channels: Map<string, Channel>;
  captions: Map<string, string>;
};

function getRegistry() {
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  scope[REGISTRY_KEY] ??= { channels: new Map(), captions: new Map() };
  return scope[REGISTRY_KEY];
}

export function conversationBrowserTarget(conversationId: string | undefined) {
  const bot = conversationId ? getBotByConversationId(conversationId) : null;
  if (bot) return botBrowserTarget(bot);
  return userBrowserTarget(conversationId ? getConversationOwnerId(conversationId) : null);
}

function idleState(target: BrowserSessionTarget): ComputerState {
  return {
    type: "computer_state",
    live: false,
    url: null,
    caption: getRegistry().captions.get(target.socketDir) ?? null,
    viewport: null
  };
}

export function getComputerState(target: BrowserSessionTarget): ComputerState {
  return getRegistry().channels.get(target.socketDir)?.state ?? idleState(target);
}

function sendJson(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {}
}

function broadcastState(channel: Channel) {
  for (const viewer of channel.viewers) sendJson(viewer.socket, channel.state);
}

function updateState(channel: Channel, patch: Partial<ComputerState>) {
  const next = { ...channel.state, ...patch };
  if (JSON.stringify(next) === JSON.stringify(channel.state)) return;
  channel.state = next;
  broadcastState(channel);
}

export function setComputerCaption(target: BrowserSessionTarget, caption: string | null) {
  const registry = getRegistry();
  if (caption) registry.captions.set(target.socketDir, caption);
  else registry.captions.delete(target.socketDir);
  const channel = registry.channels.get(target.socketDir);
  if (channel) updateState(channel, { caption });
}

function sendFrame(viewer: Viewer, frame: Buffer) {
  if (viewer.socket.readyState !== WebSocket.OPEN) return;
  if (viewer.socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
  viewer.lastSentAt = Date.now();
  try {
    viewer.socket.send(frame, { binary: true });
  } catch {}
}

function deliverFrame(channel: Channel, viewer: Viewer) {
  if (!channel.frame || viewer.timer) return;
  const wait = viewer.lastSentAt + viewer.minIntervalMs - Date.now();
  if (wait <= 0) {
    sendFrame(viewer, channel.frame);
    return;
  }
  viewer.timer = setTimeout(() => {
    viewer.timer = null;
    if (channel.frame) sendFrame(viewer, channel.frame);
  }, wait);
}

function readStreamPort(target: BrowserSessionTarget) {
  try {
    const port = Number(readFileSync(join(target.socketDir, `${target.sessionName}.stream`), "utf8").trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function readBoundTargetId(target: BrowserSessionTarget) {
  try {
    const bound = JSON.parse(readFileSync(join(target.socketDir, `${target.sessionName}.target`), "utf8")) as {
      targetId?: unknown;
    };
    return typeof bound.targetId === "string" ? bound.targetId : null;
  } catch {
    return null;
  }
}

function scheduleReconnect(channel: Channel) {
  if (channel.reconnect || channel.viewers.size === 0) return;
  channel.reconnect = setTimeout(() => {
    channel.reconnect = null;
    connectUpstream(channel);
  }, RECONNECT_MS);
  channel.reconnect.unref?.();
}

function jpegSize(image: Buffer) {
  let offset = 2;
  while (offset + 9 <= image.length && image[offset] === 0xff) {
    const marker = image[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: image.readUInt16BE(offset + 7), height: image.readUInt16BE(offset + 5) };
    }
    offset += 2 + image.readUInt16BE(offset + 2);
  }
  return null;
}

type UpstreamMessage = {
  type?: string;
  data?: string;
  url?: string;
  connected?: boolean;
  metadata?: { deviceWidth?: number; deviceHeight?: number };
  tabs?: Array<{ targetId?: string; url?: string }>;
};

function handleUpstreamMessage(channel: Channel, raw: WebSocket.RawData) {
  let message: UpstreamMessage;
  try {
    message = JSON.parse(raw.toString()) as UpstreamMessage;
  } catch {
    return;
  }
  if (message.type === "frame" && typeof message.data === "string") {
    channel.frame = Buffer.from(message.data, "base64");
    const width = message.metadata?.deviceWidth;
    const height = message.metadata?.deviceHeight;
    updateState(channel, {
      live: true,
      viewport: jpegSize(channel.frame) ?? (width && height ? { width, height } : channel.state.viewport)
    });
    for (const viewer of channel.viewers) deliverFrame(channel, viewer);
  } else if (message.type === "url" && typeof message.url === "string") {
    updateState(channel, { url: message.url });
  } else if (message.type === "tabs" && Array.isArray(message.tabs)) {
    const targetId = readBoundTargetId(channel.target);
    const own = message.tabs.find((tab) => tab.targetId === targetId);
    if (own?.url) updateState(channel, { url: own.url });
  } else if (message.type === "status" && message.connected === false) {
    updateState(channel, { live: false });
  }
}

function connectUpstream(channel: Channel) {
  if (channel.upstream || channel.viewers.size === 0) return;
  const port = readStreamPort(channel.target);
  if (!port) {
    scheduleReconnect(channel);
    return;
  }
  const upstream = new WebSocket(`ws://127.0.0.1:${port}/?maxFps=${UPSTREAM_MAX_FPS}`);
  channel.upstream = upstream;
  upstream.on("message", (raw) => handleUpstreamMessage(channel, raw));
  upstream.on("error", () => undefined);
  upstream.on("close", () => {
    if (channel.upstream !== upstream) return;
    channel.upstream = null;
    updateState(channel, { live: false });
    scheduleReconnect(channel);
  });
}

function closeChannel(channel: Channel) {
  if (channel.reconnect) clearTimeout(channel.reconnect);
  if (channel.touch) clearInterval(channel.touch);
  channel.reconnect = null;
  channel.touch = null;
  const upstream = channel.upstream;
  channel.upstream = null;
  upstream?.close();
  getRegistry().channels.delete(channel.target.socketDir);
}

export function attachComputerViewer(socket: WebSocket, target: BrowserSessionTarget, options: { mobile: boolean }) {
  const registry = getRegistry();
  let channel = registry.channels.get(target.socketDir);
  if (!channel) {
    channel = {
      target,
      upstream: null,
      viewers: new Set(),
      frame: null,
      state: idleState(target),
      reconnect: null,
      touch: null
    };
    registry.channels.set(target.socketDir, channel);
  }
  const active = channel;
  const viewer: Viewer = {
    socket,
    minIntervalMs: 1000 / (options.mobile ? MOBILE_VIEWER_FPS : BROWSER_VIEWER_FPS),
    lastSentAt: 0,
    timer: null
  };
  active.viewers.add(viewer);
  sendJson(socket, active.state);
  if (active.frame) sendFrame(viewer, active.frame);
  touchBrowserSession(target);
  active.touch ??= setInterval(() => touchBrowserSession(target), TOUCH_INTERVAL_MS);
  active.touch.unref?.();
  connectUpstream(active);

  socket.on("close", () => {
    if (viewer.timer) clearTimeout(viewer.timer);
    active.viewers.delete(viewer);
    if (active.viewers.size === 0) closeChannel(active);
  });
}

export function resetAgentComputerRelayForTests() {
  const registry = getRegistry();
  for (const channel of [...registry.channels.values()]) closeChannel(channel);
  registry.captions.clear();
}
