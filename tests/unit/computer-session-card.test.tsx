// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ComputerSessionCard, isBrowserAction, lastOpenedUrl } from "@/components/computer-session-card";
import type { MessageTimelineItem } from "@/lib/types";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | Blob }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  receive(data: string | Blob) {
    act(() => this.onmessage?.({ data }));
  }
}

function browserAction(id: string, detail: string, status = "completed"): Extract<MessageTimelineItem, { timelineKind: "action" }> {
  return {
    id,
    messageId: "msg_1",
    timelineKind: "action",
    kind: "shell_command",
    status,
    serverId: null,
    skillId: null,
    toolName: null,
    label: "Web browser",
    detail,
    arguments: { command: detail },
    resultSummary: "ok",
    sortOrder: 0,
    startedAt: "2026-09-26T10:00:00.000Z",
    completedAt: status === "running" ? null : "2026-09-26T10:00:01.000Z",
    proposalState: null,
    proposalPayload: null,
    proposalUpdatedAt: null
  } as Extract<MessageTimelineItem, { timelineKind: "action" }>;
}

describe("ComputerSessionCard", () => {
  let objectUrls = 0;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    objectUrls = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    URL.createObjectURL = vi.fn(() => `blob:frame-${++objectUrls}`);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes browser steps and the last page the bot opened", () => {
    const actions = [
      browserAction("a1", "agent-browser open https://example.com && agent-browser snapshot"),
      browserAction("a2", "agent-browser open 'https://github.com/login' && agent-browser get title"),
      browserAction("a3", "agent-browser click @e3")
    ];

    expect(isBrowserAction(actions[0])).toBe(true);
    expect(isBrowserAction({ ...actions[0], label: "Local command" })).toBe(false);
    expect(lastOpenedUrl(actions)).toBe("https://github.com/login");
    expect(lastOpenedUrl([browserAction("a4", "agent-browser snapshot")])).toBeNull();
  });

  it("streams the live tab with its URL and the command the bot is running", () => {
    render(
      <ComputerSessionCard
        actions={[browserAction("a1", "agent-browser open https://example.com", "running")]}
        liveConversationId="conv_1"
        stepsOpen={false}
        onToggleSteps={() => {}}
      />
    );

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://localhost:3000/ws/computer?conversationId=conv_1");
    expect(screen.getByTestId("computer-live-badge")).toHaveTextContent("Live");
    expect(screen.getByText("Waiting for the browser…")).toBeInTheDocument();

    socket.receive(JSON.stringify({
      type: "computer_state",
      live: true,
      url: "https://example.com/docs",
      caption: "agent-browser click @e7",
      viewport: { width: 1280, height: 720 }
    }));
    socket.receive(new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" }));

    expect(screen.getByTestId("computer-live-frame")).toHaveAttribute("src", "blob:frame-1");
    expect(screen.getByText("example.com/docs")).toBeInTheDocument();
    expect(screen.getByTestId("computer-caption")).toHaveTextContent("agent-browser click @e7");
  });

  it("shows only the browser's real web address while live and caps the frame height", () => {
    const actions = [browserAction("a1", "agent-browser open https://example.com", "running")];
    render(<ComputerSessionCard actions={actions} liveConversationId="conv_1" stepsOpen={false} onToggleSteps={() => {}} />);
    expect(screen.queryByText("example.com")).not.toBeInTheDocument();

    FakeWebSocket.instances[0].receive(JSON.stringify({
      type: "computer_state",
      live: true,
      url: "about:blank",
      caption: null,
      viewport: { width: 1280, height: 713 }
    }));

    expect(screen.queryByText("blank")).not.toBeInTheDocument();
    const frame = screen.getByText("Waiting for the browser…").parentElement as HTMLElement;
    expect(frame.style.aspectRatio).toBe("1280 / 713");
    expect(frame.style.width).toMatch(/^min\(100%, 1280px, 107\.71\d*vh\)$/);
  });

  it("names the last page the bot opened on a finished run", () => {
    render(<ComputerSessionCard actions={[browserAction("a1", "agent-browser open https://example.com/done")]} stepsOpen={false} onToggleSteps={() => {}} />);

    expect(screen.getByText("example.com/done")).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("keeps the last frame as a thumbnail once the run ends and lists the steps on demand", () => {
    const actions = [browserAction("a1", "agent-browser open https://example.com"), browserAction("a2", "agent-browser snapshot")];
    const onToggle = vi.fn();
    const { rerender } = render(
      <ComputerSessionCard actions={actions} liveConversationId="conv_1" stepsOpen={false} onToggleSteps={onToggle} />
    );
    FakeWebSocket.instances[0].receive(new Blob([new Uint8Array([0xff])]));

    rerender(
      <ComputerSessionCard actions={actions} stepsOpen onToggleSteps={onToggle}>
        <div>step rows</div>
      </ComputerSessionCard>
    );

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(screen.queryByTestId("computer-live-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("computer-live-frame")).not.toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "blob:frame-1");
    expect(screen.getByText("step rows")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2 steps/ }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("reconnects after the stream drops and ignores unrelated messages", () => {
    vi.useFakeTimers();
    try {
      render(
        <ComputerSessionCard actions={[browserAction("a1", "agent-browser open https://example.com", "running")]} liveConversationId="conv_1" stepsOpen={false} onToggleSteps={() => {}} />
      );
      const first = FakeWebSocket.instances[0];
      first.receive("not json");
      first.receive(JSON.stringify({ type: "other" }));
      act(() => first.onclose?.());
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(FakeWebSocket.instances).toHaveLength(2);
      act(() => FakeWebSocket.instances[1].onopen?.());
    } finally {
      vi.useRealTimers();
    }
  });
});
