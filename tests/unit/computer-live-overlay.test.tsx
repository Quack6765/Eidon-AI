// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { ComputerLiveOverlay } from "@/components/computer-live-overlay";

function mountContainer() {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

describe("ComputerLiveOverlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the live frame at the viewport aspect ratio and caps its size", () => {
    const container = mountContainer();
    render(
      <ComputerLiveOverlay
        container={container}
        frameUrl="blob:frame-1"
        viewport={{ width: 1280, height: 720 }}
        url="example.com/docs"
        onReturn={() => {}}
        onDismiss={() => {}}
      />
    );

    const frame = screen.getByTestId("computer-live-overlay-frame");
    expect(container).toContainElement(frame);
    expect(frame.querySelector("img")).toHaveAttribute("src", "blob:frame-1");
    expect(frame.style.aspectRatio).toBe("1280 / 720");
    expect(frame).toHaveAttribute("title", "Return to the live browser view — example.com/docs");
    expect(screen.getByRole("button", { name: "Return to the live browser view" })).toBe(frame);
    expect(screen.getByRole("button", { name: "Hide the live browser tile for this run" })).toBeInTheDocument();
  });

  it("carries the conversation card's header anatomy and a larger frame cap", () => {
    render(
      <ComputerLiveOverlay
        container={mountContainer()}
        frameUrl="blob:frame-1"
        viewport={{ width: 1280, height: 720 }}
        url={null}
        onReturn={() => {}}
        onDismiss={() => {}}
      />
    );

    const header = screen.getByTestId("computer-live-overlay-header");
    expect(header).toHaveTextContent("Browser");
    expect(header).toHaveTextContent("Live");
    expect(header).toContainElement(screen.getByTestId("computer-live-overlay-dismiss"));
    expect(screen.getByTestId("computer-live-overlay-card").style.width).toMatch(/^min\(44vw, 260px,/);
  });

  it("waits for the first frame without leaving an empty hole", () => {
    render(
      <ComputerLiveOverlay
        container={mountContainer()}
        frameUrl={null}
        viewport={null}
        url={null}
        onReturn={() => {}}
        onDismiss={() => {}}
      />
    );

    expect(screen.getByText("Waiting for the browser…")).toBeInTheDocument();
    expect(screen.getByTestId("computer-live-overlay-frame").style.aspectRatio).toBe("16 / 9");
    expect(screen.getByTestId("computer-live-overlay-frame")).toHaveAttribute(
      "title",
      "Return to the live browser view"
    );
  });

  it("returns to the live view on a click and dismisses only from the close button", () => {
    const onReturn = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ComputerLiveOverlay
        container={mountContainer()}
        frameUrl="blob:frame-1"
        viewport={{ width: 1280, height: 720 }}
        url={null}
        onReturn={onReturn}
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByTestId("computer-live-overlay-frame"));
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("computer-live-overlay-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a conversation viewport to sit in", () => {
    render(
      <ComputerLiveOverlay
        container={null}
        frameUrl="blob:frame-1"
        viewport={{ width: 1280, height: 720 }}
        url={null}
        onReturn={() => {}}
        onDismiss={() => {}}
      />
    );

    expect(screen.queryByTestId("computer-live-overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("computer-live-overlay-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("computer-live-overlay-frame")).not.toBeInTheDocument();
  });
});
