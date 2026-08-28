// @vitest-environment jsdom

import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { math } from "@streamdown/math";

const streamdownMock = vi.fn((props: { children?: React.ReactNode; plugins?: unknown }) =>
  React.createElement("div", null, props.children)
);

vi.mock("streamdown", () => ({
  Streamdown: (props: { children?: React.ReactNode; plugins?: unknown }) => streamdownMock(props)
}));

vi.mock("@streamdown/mermaid", () => ({
  mermaid: { name: "mermaid", type: "diagram", language: "mermaid" }
}));

import { MessageBubble } from "@/components/message-bubble";
import type { Message } from "@/lib/types";

function createMessage(role: "user" | "assistant", content: string): Message {
  return {
    id: `msg_${role}`,
    conversationId: "conv_test",
    role,
    content,
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0,
    systemKind: null,
    compactedAt: null,
    createdAt: new Date().toISOString(),
    actions: []
  };
}

function streamdownCallsFor(content: string) {
  return streamdownMock.mock.calls.filter((call) => {
    const children = call[0]?.children;
    return typeof children === "string" && children.includes(content);
  }) as Array<[{ children?: React.ReactNode; plugins?: { math?: unknown } }]>;
}

describe("math plugin wiring in chat messages", () => {
  beforeEach(() => {
    streamdownMock.mockClear();
  });

  it("passes the math plugin when rendering assistant content", () => {
    render(
      React.createElement(MessageBubble, {
        message: createMessage("assistant", "Throughput is\n\n$$T = \\frac{1}{r + c}$$")
      })
    );

    const calls = streamdownCallsFor("Throughput is");
    expect(calls.length).toBeGreaterThan(0);
    for (const [props] of calls) {
      expect(props.plugins?.math).toBe(math);
    }
  });

  it("passes the math plugin when rendering user content", () => {
    render(
      React.createElement(MessageBubble, {
        message: createMessage("user", "What about $$E = mc^2$$?")
      })
    );

    const calls = streamdownCallsFor("What about");
    expect(calls.length).toBeGreaterThan(0);
    for (const [props] of calls) {
      expect(props.plugins?.math).toBe(math);
    }
  });

  it("preserves literal LaTeX escape sequences in rendered content", () => {
    const formula = "$$P(\\text{stampede}) = 1 - \\left(1 - \\frac{1}{N}\\right)^{k}$$";

    render(
      React.createElement(MessageBubble, {
        message: createMessage("assistant", `Consider:\n\n${formula}\n\n**Bottom line:** safe.`)
      })
    );

    const calls = streamdownCallsFor("Consider:");
    expect(calls.length).toBeGreaterThan(0);
    for (const [props] of calls) {
      expect(props.children).toContain("\\left(1 - \\frac{1}{N}\\right)");
      expect(props.children).not.toContain("\night");
    }
  });
});
