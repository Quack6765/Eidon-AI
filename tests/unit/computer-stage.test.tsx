// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ComputerHandoffCard, isComputerHandoffAction } from "@/components/computer-handoff-card";
import { ComputerSessionCard } from "@/components/computer-session-card";
import { ComputerStage } from "@/components/computer-stage";
import type { MessageTimelineItem } from "@/lib/types";

type ActionItem = Extract<MessageTimelineItem, { timelineKind: "action" }>;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 1;
  binaryType = "blob";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | Blob }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  state(patch: Record<string, unknown>) {
    act(() =>
      this.onmessage?.({
        data: JSON.stringify({ type: "computer_state", live: true, controlOwner: "bot", url: null, caption: null, viewport: { width: 1000, height: 500 }, ...patch })
      })
    );
  }
  inputs() {
    return this.sent.map((item) => JSON.parse(item));
  }
}

function action(overrides: Partial<ActionItem>): ActionItem {
  return {
    id: "act_1",
    messageId: "msg_1",
    timelineKind: "action",
    kind: "shell_command",
    status: "running",
    serverId: null,
    skillId: null,
    toolName: null,
    label: "Web browser",
    detail: "agent-browser open https://github.com/login",
    arguments: null,
    resultSummary: "",
    sortOrder: 0,
    startedAt: "2026-09-26T10:00:00.000Z",
    completedAt: null,
    proposalState: null,
    proposalPayload: null,
    proposalUpdatedAt: null,
    ...overrides
  } as ActionItem;
}

function handoff(overrides: Partial<ActionItem> = {}) {
  return action({
    id: "act_handoff",
    kind: "computer_handoff",
    status: "pending",
    label: "Your turn in the browser",
    detail: "Enter the two-factor code",
    proposalState: "pending",
    proposalPayload: { operation: "computer_handoff", reason: "Enter the two-factor code" },
    ...overrides
  }) as ActionItem & { proposalPayload: { operation: "computer_handoff"; reason: string } };
}

function rect(element: Element) {
  element.getBoundingClientRect = () => ({ left: 100, top: 50, width: 1000, height: 500, right: 1100, bottom: 550, x: 100, y: 50, toJSON: () => ({}) });
}

describe("browser control", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("PointerEvent", class extends MouseEvent {});
    URL.createObjectURL = vi.fn(() => "blob:frame");
    URL.revokeObjectURL = vi.fn();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ computer: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the user's clicks, scrolls, keys and pastes to the page", () => {
    const onClose = vi.fn();
    render(<ComputerStage conversationId="conv_1" onClose={onClose} />);
    const socket = FakeWebSocket.instances[0];
    socket.state({ controlOwner: "user", url: "https://github.com/login" });

    expect(screen.getByRole("dialog", { name: "You're in control of the browser" })).toBeInTheDocument();
    expect(screen.getByText(/github\.com\/login · the bot can't use the browser/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Note for the bot")).not.toBeInTheDocument();

    const frame = screen.getByTestId("computer-stage-frame");
    rect(frame);
    fireEvent.pointerDown(frame, { clientX: 600, clientY: 300, button: 0, detail: 2 });
    fireEvent.pointerUp(frame, { clientX: 600, clientY: 300, button: 2 });
    fireEvent.pointerMove(frame, { clientX: 1100, clientY: 550 });
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 });
    fireEvent.wheel(frame, { clientX: 350, clientY: 175, deltaX: 0, deltaY: 120 });
    const keys = screen.getByTestId("computer-stage-keys");
    fireEvent.keyDown(keys, { key: "a", metaKey: true });
    fireEvent.keyUp(keys, { key: "Shift", shiftKey: true });
    fireEvent.keyDown(keys, { key: "v", ctrlKey: true });
    fireEvent.paste(keys, { clipboardData: { getData: () => "hunter2" } });
    fireEvent.paste(keys, { clipboardData: { getData: () => "" } });

    expect(socket.inputs()).toEqual([
      { type: "computer_pointer", action: "down", x: 0.5, y: 0.5, button: "left", clickCount: 2 },
      { type: "computer_pointer", action: "up", x: 0.5, y: 0.5, button: "right", clickCount: 1 },
      { type: "computer_pointer", action: "move", x: 1, y: 1 },
      { type: "computer_wheel", x: 0.25, y: 0.25, deltaX: 0, deltaY: 120 },
      { type: "computer_key", action: "down", key: "a", modifiers: 4 },
      { type: "computer_key", action: "up", key: "Shift", modifiers: 8 },
      { type: "computer_text", text: "hunter2" }
    ]);
  });

  it("types from the mobile keyboard field", () => {
    render(<ComputerStage conversationId="conv_1" onClose={() => {}} />);
    const socket = FakeWebSocket.instances[0];
    socket.state({ controlOwner: "user" });
    const field = screen.getByRole("textbox", { name: "Type into the page" });

    fireEvent.click(screen.getByRole("button", { name: "Type into the page" }));
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "q" });
    (field as HTMLTextAreaElement).value = "hi";
    fireEvent.input(field);

    expect(socket.inputs()).toEqual([
      { type: "computer_key", action: "down", key: "Enter" },
      { type: "computer_key", action: "up", key: "Enter" },
      { type: "computer_text", text: "hi" }
    ]);
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  it("returns control with the user's note, and closes when the bot gets it back", async () => {
    const onClose = vi.fn();
    render(<ComputerStage conversationId="conv 1" askForNote onClose={onClose} />);
    const socket = FakeWebSocket.instances[0];
    socket.state({ controlOwner: "user" });

    fireEvent.change(screen.getByLabelText("Note for the bot"), { target: { value: "  Code entered  " } });
    fireEvent.click(screen.getByRole("button", { name: "Return control" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/conversations/conv%201/computer/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return", note: "Code entered" })
    });

    socket.state({ controlOwner: "bot" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the stage open and explains when control could not be returned", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404 }));
    const onClose = vi.fn();
    render(<ComputerStage conversationId="conv_1" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Return control" }));

    expect(await screen.findByText("Conversation not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimize the browser" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers the bot's hand-off and opens the browser for the user", () => {
    const card = handoff();
    expect(isComputerHandoffAction(card)).toBe(true);
    expect(isComputerHandoffAction(action({}))).toBe(false);
    render(<ComputerHandoffCard action={card} conversationId="conv_1" />);

    expect(screen.getByText("Your turn in the browser")).toBeInTheDocument();
    expect(screen.getByText("Enter the two-factor code")).toBeInTheDocument();
    expect(screen.getByText(/Messages you send now reach it after you return control/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(screen.getByTestId("computer-stage")).toBeInTheDocument();
    expect(screen.getByLabelText("Note for the bot")).toBeInTheDocument();
  });

  it("shows how a hand-off ended without offering it again", () => {
    render(
      <ComputerHandoffCard
        action={handoff({
          status: "completed",
          proposalState: "approved",
          resultSummary: "You returned control",
          proposalPayload: { operation: "computer_handoff", reason: "Enter the code", resolution: "returned", note: "Done" }
        })}
        conversationId="conv_1"
      />
    );

    expect(screen.getByText("You returned control")).toBeInTheDocument();
    expect(screen.getByText("Your note: Done")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take over" })).not.toBeInTheDocument();
  });

  it("lets the user take control of a live run and hand it back from the card", async () => {
    render(<ComputerSessionCard actions={[action({})]} liveConversationId="conv_1" stepsOpen={false} onToggleSteps={() => {}} />);
    const cardSocket = FakeWebSocket.instances[0];
    const take = screen.getByRole("button", { name: "Take control" });
    expect(take).toBeDisabled();

    cardSocket.state({});
    fireEvent.click(take);
    await waitFor(() => expect(screen.getByTestId("computer-stage")).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "take" });

    fireEvent.click(screen.getByRole("button", { name: "Minimize the browser" }));
    cardSocket.state({ controlOwner: "user" });
    expect(screen.getByTestId("computer-user-control")).toHaveTextContent("You're in control of the browser");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("computer-stage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimize the browser" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Return control" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "return" });
  });

  it("explains when control could not be taken", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    render(<ComputerSessionCard actions={[action({})]} liveConversationId="conv_1" stepsOpen={false} onToggleSteps={() => {}} />);
    FakeWebSocket.instances[0].state({});

    fireEvent.click(screen.getByRole("button", { name: "Take control" }));

    expect(await screen.findByText("Could not take control")).toBeInTheDocument();
    expect(screen.queryByTestId("computer-stage")).not.toBeInTheDocument();
  });
});
