// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BotStatusChip, BotStatusDot } from "@/components/agents/bot-status";

describe("BotStatusDot", () => {
  it("renders nothing when idle without pending input", () => {
    const { container } = render(<BotStatusDot status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the purple waiting-for-input dot in place of the idle state", () => {
    const { container } = render(<BotStatusDot status="idle" waitingForInput />);
    expect(container.querySelector("span")?.className).toContain("bg-[var(--accent)]");
  });

  it("takes precedence over the running spinner", () => {
    const { container } = render(<BotStatusDot status="running" waitingForInput />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span")?.className).toContain("bg-[var(--accent)]");
  });

  it("takes precedence over the queued dot", () => {
    const { container } = render(<BotStatusDot status="queued" waitingForInput />);
    expect(container.querySelector("span")?.className).toContain("bg-[var(--accent)]");
    expect(container.querySelector("span")?.className).not.toContain("bg-amber-400");
  });

  it("renders the accent dot for a bot waiting on a tool approval", () => {
    const { container } = render(<BotStatusDot status="waiting_approval" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span")?.className).toContain("bg-[var(--accent)]");
  });

  it("still renders the running spinner when no input is pending", () => {
    const { container } = render(<BotStatusDot status="running" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
  });
});

describe("BotStatusChip", () => {
  it("renders a waiting-for-input chip that takes precedence over running", () => {
    render(<BotStatusChip status="running" waitingForInput />);
    expect(screen.getByText("Waiting for input")).toBeInTheDocument();
    expect(screen.queryByLabelText("Running")).toBeNull();
  });

  it("renders a waiting-for-input chip that takes precedence over queued", () => {
    render(<BotStatusChip status="queued" waitingForInput />);
    expect(screen.getByText("Waiting for input")).toBeInTheDocument();
    expect(screen.queryByText("Queued")).toBeNull();
  });

  it("labels a bot paused on a tool approval as needing approval", () => {
    render(<BotStatusChip status="waiting_approval" waitingForInput />);
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for input")).toBeNull();
  });

  it("renders the queued chip when no input is pending", () => {
    render(<BotStatusChip status="queued" />);
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });
});
