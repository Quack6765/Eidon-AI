// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const stickContextMock = vi.hoisted(() => ({
  isAtBottom: false,
  scrollToBottom: vi.fn()
}));

vi.mock("use-stick-to-bottom", () => ({
  StickToBottom: Object.assign(
    ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
    { Content: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children) }
  ),
  useStickToBottomContext: () => stickContextMock
}));

import { ConversationScrollButton } from "@/components/ai-elements/conversation";

describe("ConversationScrollButton", () => {
  it("renders nothing while pinned to the bottom", () => {
    stickContextMock.isAtBottom = true;
    render(React.createElement(ConversationScrollButton));
    expect(screen.queryByRole("button", { name: "Scroll to latest messages" })).toBeNull();
  });

  it("scrolls decisively on click, overriding in-flight user scrolling", () => {
    stickContextMock.isAtBottom = false;
    stickContextMock.scrollToBottom.mockClear();
    render(React.createElement(ConversationScrollButton));

    fireEvent.click(screen.getByRole("button", { name: "Scroll to latest messages" }));

    expect(stickContextMock.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(stickContextMock.scrollToBottom).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreEscapes: true,
        animation: expect.objectContaining({ stiffness: expect.any(Number) })
      })
    );
  });

  it("sits flush against the composer area top", () => {
    stickContextMock.isAtBottom = false;
    render(React.createElement(ConversationScrollButton));

    const button = screen.getByRole("button", { name: "Scroll to latest messages" });
    expect(button.className).toContain("bottom-[var(--composer-height,160px)]");
  });
});
