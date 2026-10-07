// @vitest-environment jsdom

import React from "react";
import { render, waitFor } from "@testing-library/react";

import type { FollowUpDemoPhase } from "@/components/onboarding/demos/demo-script";
import {
  QueueFollowUpDemo,
  SteerFollowUpDemo
} from "@/components/onboarding/demos/follow-up-demo";

const DONE_THINK = { id: "think", label: "Thinking", status: "completed" as const };
const DONE_WORKSPACE = { id: "workspace", label: "Search workspace", status: "completed" as const };

const STEER_ACK = "Switching to European data.";
const STEER_ANSWER = "Europe included: 9% growth.";
const QUEUE_ANSWER = "Revenue grew 12%, ahead of market.";
const MESSAGE = "Use the European numbers too";

function phase(overrides: Partial<FollowUpDemoPhase> = {}): FollowUpDemoPhase {
  return {
    pills: [DONE_THINK, DONE_WORKSPACE],
    sent: true,
    routed: true,
    settled: true,
    newTurn: false,
    replied: false,
    ...overrides
  };
}

const JUST_SENT = phase({ pills: [{ ...DONE_THINK, status: "running" }], routed: false, settled: false });
const ROUTED = phase({
  pills: [DONE_THINK, { ...DONE_WORKSPACE, status: "running" }],
  settled: false
});
const SETTLED = phase();
const NEW_TURN = phase({ newTurn: true });
const REPLIED = phase({ newTurn: true, replied: true });
const BEFORE_SEND = phase({ pills: [{ ...DONE_THINK, status: "running" }], sent: false, routed: false, settled: false });

function textOf(node: HTMLElement) {
  return node.textContent ?? "";
}

function frameOf(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

function bubbleRoot(container: HTMLElement) {
  const bubble = [...container.querySelectorAll("span")].find(
    (node) => node.textContent.trim() === MESSAGE
  );
  return bubble?.parentElement ?? null;
}

/** Streamed text arrives a character at a time, so agent lines need waiting for. */
async function expectStreamed(container: HTMLElement, expected: string) {
  await waitFor(() => expect(textOf(container)).toContain(expected), { timeout: 4000 });
}

describe("follow-up onboarding demos", () => {
  it("marks the message as just sent by the user, in both tiles", () => {
    const steer = render(<SteerFollowUpDemo phase={JUST_SENT} />);
    expect(textOf(steer.container)).toContain("You sent this");
    expect(textOf(steer.container)).toContain(MESSAGE);
    steer.unmount();

    const queue = render(<QueueFollowUpDemo phase={JUST_SENT} />);
    expect(textOf(queue.container)).toContain("You sent this");
    expect(textOf(queue.container)).toContain(MESSAGE);
  });

  it("holds the just-sent message at the bottom of the frame, below the run", () => {
    const { container } = render(<QueueFollowUpDemo phase={JUST_SENT} />);
    const frame = frameOf(container);

    expect(frame.children).toHaveLength(3);
    expect(textOf(frame.children[2] as HTMLElement)).toContain("You sent this");
  });

  it("fades the user message in, and settles fully visible", async () => {
    for (const View of [SteerFollowUpDemo, QueueFollowUpDemo]) {
      const view = render(<View phase={JUST_SENT} />);
      const bubble = [...view.container.querySelectorAll("span")].find(
        (node) => node.textContent.trim() === MESSAGE
      );
      const fadeWrapper = bubble?.parentElement?.parentElement as HTMLElement | undefined;

      // Starts faded...
      expect(Number(fadeWrapper?.style.opacity)).toBeLessThan(1);
      // ...and the timer ramp has to reach fully visible, never rest part-way.
      await waitFor(() => expect(fadeWrapper?.style.opacity).toBe("1"), { timeout: 3000 });
      view.unmount();
    }
  });

  it("does not show the message at all before the user sends it", () => {
    const { container } = render(<SteerFollowUpDemo phase={BEFORE_SEND} />);

    expect(textOf(container)).not.toContain(MESSAGE);
    expect(textOf(container)).not.toContain("You sent this");
  });

  it("routes a steered message between the two tool calls and answers the steer", async () => {
    const { container } = render(<SteerFollowUpDemo phase={ROUTED} />);

    expect(textOf(container)).toContain("Steer");
    expect(textOf(container)).toContain("sends between tool calls");

    await expectStreamed(container, STEER_ACK);

    const text = textOf(container);
    expect(text.indexOf(MESSAGE)).toBeGreaterThan(text.indexOf("Thinking"));
    expect(text.indexOf(MESSAGE)).toBeLessThan(text.indexOf("Search workspace"));
    expect(text.indexOf(STEER_ACK)).toBeGreaterThan(text.indexOf(MESSAGE));
  });

  it("keeps the steered message in place once the run settles", async () => {
    const { container } = render(<SteerFollowUpDemo phase={SETTLED} />);

    await expectStreamed(container, STEER_ANSWER);

    const text = textOf(container);
    expect(text.indexOf(MESSAGE)).toBeLessThan(text.indexOf("Search workspace"));
    expect(text.indexOf(STEER_ANSWER)).toBeGreaterThan(text.indexOf(MESSAGE));
  });

  it("streams the agent's reply a character at a time instead of dropping it in", async () => {
    const { container } = render(<SteerFollowUpDemo phase={SETTLED} />);

    // Nothing yet on the first paint...
    expect(textOf(container)).not.toContain(STEER_ANSWER);

    // ...and it arrives over the following moments.
    await expectStreamed(container, STEER_ANSWER);
  });

  it("renders the steer acknowledgement as an agent message, styled like the answer", async () => {
    const { container } = render(<SteerFollowUpDemo phase={SETTLED} />);

    await expectStreamed(container, STEER_ACK);
    await expectStreamed(container, STEER_ANSWER);

    const lines = [...container.querySelectorAll("p")];
    const ack = lines.find((line) => line.textContent === STEER_ACK);
    const answer = lines.find((line) => line.textContent === STEER_ANSWER);

    expect(ack).toBeDefined();
    expect(answer).toBeDefined();
    // The agent speaks in one voice: both lines carry the same treatment.
    expect(ack?.className).toBe(answer?.className);
    expect(ack?.className).toContain("text-white/85");
  });

  it("dims the queued message while the run is still working, then returns it to full contrast", () => {
    const working = render(<QueueFollowUpDemo phase={ROUTED} />);
    expect(bubbleRoot(working.container)?.className).toContain("opacity-[0.45]");
    working.unmount();

    const settled = render(<QueueFollowUpDemo phase={SETTLED} />);
    expect(bubbleRoot(settled.container)?.className).toContain("opacity-100");
  });

  it("keeps the message fully visible in every stage", () => {
    for (const stage of [JUST_SENT, ROUTED, SETTLED, NEW_TURN]) {
      for (const View of [QueueFollowUpDemo, SteerFollowUpDemo]) {
        const view = render(<View phase={stage} />);
        expect(bubbleRoot(view.container)).not.toBeNull();
        expect(bubbleRoot(view.container)?.className).not.toContain("opacity-0 ");
        view.unmount();
      }
    }
  });

  it("leaves a queued message waiting at the bottom, below the answer", async () => {
    const { container } = render(<QueueFollowUpDemo phase={SETTLED} />);
    const frame = frameOf(container);

    expect(textOf(container)).toContain("Queued");
    expect(textOf(container)).toContain("sends after this run");
    expect(textOf(container)).not.toContain("sends between tool calls");

    await expectStreamed(container, QUEUE_ANSWER);

    expect(frame.children).toHaveLength(3);
    expect(textOf(container).indexOf(MESSAGE)).toBeGreaterThan(
      textOf(container).indexOf(QUEUE_ANSWER)
    );
  });

  it("moves the queued message into the transcript and shows the agent starting a new turn", async () => {
    const { container } = render(<QueueFollowUpDemo phase={NEW_TURN} />);
    const frame = frameOf(container);

    await expectStreamed(container, QUEUE_ANSWER);

    // Out of the pinned slot and into the transcript, directly after the answer.
    expect(frame.children).toHaveLength(2);

    const text = textOf(container);
    expect(text).toContain("New turn");
    expect(text).toContain("the agent starts here");
    expect(text).not.toContain("sends after this run");
    expect(text.indexOf(MESSAGE)).toBeGreaterThan(text.indexOf(QUEUE_ANSWER));
    // The new turn's own activity starts after the message it belongs to.
    expect(text.lastIndexOf("Thinking")).toBeGreaterThan(text.indexOf(MESSAGE));
  });

  it("renders both tiles side by side, each with its own routed message", () => {
    const { container } = render(
      <div>
        <SteerFollowUpDemo phase={SETTLED} />
        <QueueFollowUpDemo phase={SETTLED} />
      </div>
    );

    const tiles = [...container.querySelectorAll('[style*="height"]')].filter((node) =>
      node.className.includes("overflow-hidden")
    );

    expect(tiles).toHaveLength(2);
    expect(textOf(tiles[0] as HTMLElement)).toContain("sends between tool calls");
    expect(textOf(tiles[1] as HTMLElement)).toContain("sends after this run");
    expect(textOf(tiles[0] as HTMLElement)).not.toContain("sends after this run");
    expect(textOf(tiles[1] as HTMLElement)).not.toContain("sends between tool calls");
  });

  it("answers the message once it becomes its own turn", async () => {
    const { container } = render(<QueueFollowUpDemo phase={REPLIED} />);

    await expectStreamed(container, STEER_ANSWER);

    const text = textOf(container);
    expect(text.indexOf(STEER_ANSWER)).toBeGreaterThan(text.indexOf(MESSAGE));
    // The new turn's own activity has finished, so its spinner is gone.
    expect(text.trimEnd().endsWith(STEER_ANSWER)).toBe(true);
  });

  it("paints every state pill the same violet", () => {
    for (const stage of [JUST_SENT, ROUTED, SETTLED, NEW_TURN]) {
      const view = render(<QueueFollowUpDemo phase={stage} />);
      const chips = [...view.container.querySelectorAll("span")].filter(
        (node) => node.className.includes("uppercase") && node.className.includes("rounded-full")
      );

      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) {
        expect(chip.className).toContain("violet-400");
        expect(chip.className).not.toContain("border-white/12");
      }
      view.unmount();
    }
  });
});
