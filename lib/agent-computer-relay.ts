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
import type { ComputerControlOwner, ComputerState } from "@/lib/types";

const REGISTRY_KEY = Symbol.for("eidon.agent-computer-relay");
const MAX_BUFFERED_BYTES = 256 * 1024;
const RECONNECT_MS = 2_000;
const TOUCH_INTERVAL_MS = 60_000;
const BROWSER_VIEWER_FPS = 15;
const MOBILE_VIEWER_FPS = 8;
const UPSTREAM_MAX_FPS = 15;
const MAX_INPUTS_PER_SECOND = 120;
const MAX_TEXT_CHARS = 2_000;
const MODIFIER_ALT = 1;
const MODIFIER_CTRL = 2;
const MODIFIER_META = 4;
const MODIFIER_SHIFT = 8;

const VIRTUAL_KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46
};

type Viewer = {
  socket: WebSocket;
  minIntervalMs: number;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  inputWindowStartedAt: number;
  inputsInWindow: number;
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
  userControlled: Set<string>;
  handoffs: Map<string, string>;
};

function getRegistry() {
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  scope[REGISTRY_KEY] ??= { channels: new Map(), captions: new Map(), userControlled: new Set(), handoffs: new Map() };
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
    controlOwner: getComputerControl(target),
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

export function getComputerControl(target: BrowserSessionTarget): ComputerControlOwner {
  return getRegistry().userControlled.has(target.socketDir) ? "user" : "bot";
}

export function setComputerControl(target: BrowserSessionTarget, owner: ComputerControlOwner) {
  const registry = getRegistry();
  if (owner === "user") registry.userControlled.add(target.socketDir);
  else registry.userControlled.delete(target.socketDir);
  const channel = registry.channels.get(target.socketDir);
  if (channel) updateState(channel, { controlOwner: owner });
}

export function registerComputerHandoff(target: BrowserSessionTarget, actionId: string) {
  getRegistry().handoffs.set(target.socketDir, actionId);
}

export function clearComputerHandoff(target: BrowserSessionTarget, actionId: string) {
  const handoffs = getRegistry().handoffs;
  if (handoffs.get(target.socketDir) === actionId) handoffs.delete(target.socketDir);
}

export function getComputerHandoff(target: BrowserSessionTarget) {
  return getRegistry().handoffs.get(target.socketDir) ?? null;
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

type ViewerInput =
  | { type: "computer_pointer"; action: "down" | "up" | "move"; x: number; y: number; button?: string; clickCount?: number }
  | { type: "computer_wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "computer_key"; action: "down" | "up"; key: string; code?: string; modifiers?: number }
  | { type: "computer_text"; text: string };

function keyCode(key: string) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key === " ") return "Space";
  return key;
}

function virtualKeyCode(key: string) {
  if (VIRTUAL_KEY_CODES[key]) return VIRTUAL_KEY_CODES[key];
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  return 0;
}

function toPageModifiers(modifiers: number | undefined) {
  const bits = Number.isInteger(modifiers) ? (modifiers as number) & 15 : 0;
  return bits & MODIFIER_META ? (bits & ~MODIFIER_META) | MODIFIER_CTRL : bits;
}

function keyEvents(key: string, action: "down" | "up", modifiers: number) {
  const code = keyCode(key);
  const printable = key.length === 1 && !(modifiers & (MODIFIER_CTRL | MODIFIER_ALT));
  return {
    type: "input_keyboard",
    eventType: action === "down" ? "keyDown" : "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode(key),
    modifiers,
    ...(action === "down" && printable ? { text: key } : action === "down" && key === "Enter" ? { text: "\r" } : {})
  };
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function toUpstreamInputs(channel: Channel, input: ViewerInput): unknown[] {
  const width = channel.state.viewport?.width ?? 0;
  const height = channel.state.viewport?.height ?? 0;
  if (input.type === "computer_text") {
    return [...input.text.slice(0, MAX_TEXT_CHARS)].flatMap((char) => [
      keyEvents(char, "down", 0),
      keyEvents(char, "up", 0)
    ]);
  }
  if (input.type === "computer_key") {
    if (typeof input.key !== "string" || !input.key || input.key.length > 32) return [];
    return [keyEvents(input.key, input.action === "up" ? "up" : "down", toPageModifiers(input.modifiers))];
  }
  if (!width || !height) return [];
  const x = Math.round(clampUnit(input.x) * width);
  const y = Math.round(clampUnit(input.y) * height);
  if (input.type === "computer_wheel") {
    const deltaX = Math.max(-2_000, Math.min(2_000, Number(input.deltaX) || 0));
    const deltaY = Math.max(-2_000, Math.min(2_000, Number(input.deltaY) || 0));
    return [{ type: "input_mouse", eventType: "mouseWheel", x, y, deltaX, deltaY }];
  }
  const eventType = input.action === "down" ? "mousePressed" : input.action === "up" ? "mouseReleased" : "mouseMoved";
  const button = input.button === "right" || input.button === "middle" ? input.button : input.action === "move" ? "none" : "left";
  const clickCount = input.action === "move" ? 0 : Math.min(3, Math.max(1, Number(input.clickCount) || 1));
  return [{ type: "input_mouse", eventType, x, y, button, clickCount }];
}

function allowInput(viewer: Viewer, now = Date.now()) {
  if (now - viewer.inputWindowStartedAt >= 1000) {
    viewer.inputWindowStartedAt = now;
    viewer.inputsInWindow = 0;
  }
  viewer.inputsInWindow += 1;
  return viewer.inputsInWindow <= MAX_INPUTS_PER_SECOND;
}

function handleViewerMessage(channel: Channel, viewer: Viewer, raw: WebSocket.RawData) {
  if (getComputerControl(channel.target) !== "user" || !allowInput(viewer)) return;
  const upstream = channel.upstream;
  if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
  let input: ViewerInput;
  try {
    input = JSON.parse(raw.toString()) as ViewerInput;
  } catch {
    return;
  }
  if (!input || typeof input !== "object" || typeof input.type !== "string") return;
  if (input.type === "computer_text" && typeof input.text !== "string") return;
  if (input.type !== "computer_pointer" && input.type !== "computer_wheel" && input.type !== "computer_key" && input.type !== "computer_text") return;
  for (const message of toUpstreamInputs(channel, input)) {
    upstream.send(JSON.stringify(message));
  }
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
    timer: null,
    inputWindowStartedAt: 0,
    inputsInWindow: 0
  };
  active.viewers.add(viewer);
  sendJson(socket, active.state);
  if (active.frame) sendFrame(viewer, active.frame);
  touchBrowserSession(target);
  active.touch ??= setInterval(() => touchBrowserSession(target), TOUCH_INTERVAL_MS);
  active.touch.unref?.();
  connectUpstream(active);

  socket.on("message", (raw: WebSocket.RawData) => handleViewerMessage(active, viewer, raw));
  socket.on("close", () => {
    if (viewer.timer) clearTimeout(viewer.timer);
    active.viewers.delete(viewer);
    if (active.viewers.size > 0) return;
    if (!getComputerHandoff(target)) setComputerControl(target, "bot");
    closeChannel(active);
  });
}

export function resetAgentComputerRelayForTests() {
  const registry = getRegistry();
  for (const channel of [...registry.channels.values()]) closeChannel(channel);
  registry.captions.clear();
  registry.userControlled.clear();
  registry.handoffs.clear();
}
