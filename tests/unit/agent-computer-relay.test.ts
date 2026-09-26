import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { upstreams } = vi.hoisted(() => ({ upstreams: [] as Array<EventEmitter & { url: string; close: ReturnType<typeof vi.fn> }> }));

vi.mock("ws", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class FakeUpstream extends Emitter {
    static OPEN = 1;
    close = vi.fn(() => this.emit("close"));
    constructor(public url: string) {
      super();
      upstreams.push(this as unknown as EventEmitter & { url: string; close: ReturnType<typeof vi.fn> });
    }
  }
  return { default: FakeUpstream };
});

import {
  attachComputerViewer,
  conversationBrowserTarget,
  getComputerState,
  resetAgentComputerRelayForTests,
  setComputerCaption
} from "@/lib/agent-computer-relay";
import { botBrowserTarget, userBrowserTarget, type BrowserSessionTarget } from "@/lib/agent-computer";
import { createBot } from "@/lib/bots";
import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

class FakeViewer extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: Array<string | Buffer> = [];
  send(data: string | Buffer) {
    this.sent.push(data);
  }
  json() {
    return this.sent.filter((item): item is string => typeof item === "string").map((item) => JSON.parse(item));
  }
  frames() {
    return this.sent.filter((item): item is Buffer => Buffer.isBuffer(item));
  }
}

function target(name: string): BrowserSessionTarget {
  return botBrowserTarget({ id: `bot-${name}`, userId: "user_relay" });
}

function writeStreamPort(session: BrowserSessionTarget, port: number, targetId = "OWN") {
  mkdirSync(session.socketDir, { recursive: true });
  writeFileSync(join(session.socketDir, "tab.stream"), String(port));
  writeFileSync(join(session.socketDir, "tab.target"), JSON.stringify({ targetId }));
}

function emitUpstream(index: number, message: unknown) {
  upstreams[index].emit("message", Buffer.from(JSON.stringify(message)));
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const frame = (width = 1280, height = 720) => ({
  type: "frame",
  data: JPEG.toString("base64"),
  metadata: { deviceWidth: width, deviceHeight: height }
});

describe("agent computer relay", () => {
  beforeEach(() => {
    upstreams.length = 0;
    resetAgentComputerRelayForTests();
  });

  it("resolves a bot conversation to its bot tab and a regular chat to its owner's session", async () => {
    const owner = await createLocalUser({ username: "relay-owner", password: "password-123", role: "user" });
    const bot = createBot({ name: "Scout" }, owner.id);
    const chat = createConversation("Chat", null, {}, owner.id);

    expect(conversationBrowserTarget(bot.homeConversationId)).toEqual(botBrowserTarget(bot));
    expect(conversationBrowserTarget(chat.id)).toEqual(userBrowserTarget(owner.id));
    expect(conversationBrowserTarget(undefined)).toEqual(userBrowserTarget(null));
  });

  it("relays frames as binary JPEG and forwards only the tab's own state", () => {
    const session = target("a");
    writeStreamPort(session, 45_001);
    const viewer = new FakeViewer();

    attachComputerViewer(viewer as never, session, { mobile: false });
    expect(upstreams[0].url).toBe("ws://127.0.0.1:45001/?maxFps=15");
    expect(viewer.json()[0]).toEqual({ type: "computer_state", live: false, url: null, caption: null, viewport: null });

    emitUpstream(0, { type: "tabs", tabs: [{ targetId: "OTHER", url: "https://other-bot.example" }, { targetId: "OWN", url: "https://example.com/" }] });
    emitUpstream(0, { type: "command", action: "fill", params: { value: "hunter2" } });
    emitUpstream(0, frame());
    emitUpstream(0, { type: "url", url: "https://example.org/" });

    expect(viewer.frames()).toEqual([JPEG]);
    expect(viewer.json().at(-1)).toEqual({
      type: "computer_state",
      live: true,
      url: "https://example.org/",
      caption: null,
      viewport: { width: 1280, height: 720 }
    });
    const text = JSON.stringify(viewer.json());
    expect(text).not.toContain("other-bot");
    expect(text).not.toContain("hunter2");
  });

  it("caps each viewer's frame rate and always sends the newest frame", () => {
    vi.useFakeTimers();
    try {
      const session = target("b");
      writeStreamPort(session, 45_002);
      const desktop = new FakeViewer();
      const phone = new FakeViewer();
      attachComputerViewer(desktop as never, session, { mobile: false });
      attachComputerViewer(phone as never, session, { mobile: true });

      emitUpstream(0, frame());
      const newest = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
      emitUpstream(0, { type: "frame", data: newest.toString("base64"), metadata: { deviceWidth: 1280, deviceHeight: 720 } });
      emitUpstream(0, { type: "frame", data: newest.toString("base64"), metadata: { deviceWidth: 1280, deviceHeight: 720 } });
      expect(desktop.frames()).toHaveLength(1);

      vi.advanceTimersByTime(70);
      expect(desktop.frames()).toEqual([JPEG, newest]);
      expect(phone.frames()).toHaveLength(1);
      vi.advanceTimersByTime(60);
      expect(phone.frames()).toEqual([JPEG, newest]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops frames for a viewer whose connection is backed up", () => {
    const session = target("c");
    writeStreamPort(session, 45_003);
    const slow = new FakeViewer();
    slow.bufferedAmount = 512 * 1024;
    attachComputerViewer(slow as never, session, { mobile: false });

    emitUpstream(0, frame());

    expect(slow.frames()).toHaveLength(0);
  });

  it("shows the running browser command as the caption, with or without viewers", () => {
    const session = target("d");
    writeStreamPort(session, 45_004);
    setComputerCaption(session, "agent-browser open https://example.com");
    expect(getComputerState(session).caption).toBe("agent-browser open https://example.com");

    const viewer = new FakeViewer();
    attachComputerViewer(viewer as never, session, { mobile: false });
    expect(viewer.json()[0].caption).toBe("agent-browser open https://example.com");

    setComputerCaption(session, null);
    expect(viewer.json().at(-1).caption).toBeNull();
    expect(getComputerState(session).caption).toBeNull();
  });

  it("waits for the tab's stream, reconnects after it drops, and stops when the last viewer leaves", () => {
    vi.useFakeTimers();
    try {
      const session = target("e");
      const viewer = new FakeViewer();
      attachComputerViewer(viewer as never, session, { mobile: false });
      expect(upstreams).toHaveLength(0);

      writeStreamPort(session, 45_005);
      vi.advanceTimersByTime(2_000);
      expect(upstreams).toHaveLength(1);

      emitUpstream(0, frame());
      upstreams[0].emit("close");
      expect(viewer.json().at(-1).live).toBe(false);
      vi.advanceTimersByTime(2_000);
      expect(upstreams).toHaveLength(2);

      emitUpstream(1, { type: "status", connected: false });
      viewer.emit("close");
      expect(upstreams[1].close).toHaveBeenCalled();
      expect(getComputerState(session)).toEqual({ type: "computer_state", live: false, url: null, caption: null, viewport: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a newly joined viewer the latest frame right away and ignores malformed messages", () => {
    const session = target("f");
    writeStreamPort(session, 45_006);
    const first = new FakeViewer();
    attachComputerViewer(first as never, session, { mobile: false });
    upstreams[0].emit("message", Buffer.from("not json"));
    emitUpstream(0, frame(800, 600));

    const late = new FakeViewer();
    attachComputerViewer(late as never, session, { mobile: false });

    expect(upstreams).toHaveLength(1);
    expect(late.frames()).toEqual([JPEG]);
    expect(late.json()[0].viewport).toEqual({ width: 800, height: 600 });
  });

  it("sizes the view from the JPEG itself when the stream metadata disagrees", () => {
    const session = botBrowserTarget({ id: "relay-jpeg-size", userId: null });
    writeStreamPort(session, 9300);
    const viewer = new FakeViewer();
    attachComputerViewer(viewer as never, session, { mobile: false });
    const sized = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xc9, 0x05, 0x00, 0x03, 0xff, 0xd9
    ]);

    emitUpstream(0, { type: "frame", data: sized.toString("base64"), metadata: { deviceWidth: 1280, deviceHeight: 720 } });

    expect(viewer.json().at(-1).viewport).toEqual({ width: 1280, height: 713 });
  });
});
