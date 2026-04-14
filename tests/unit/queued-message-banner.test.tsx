// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { QueuedMessageBanner } from "@/components/queued-message-banner";
import type { QueuedMessage } from "@/lib/types";

function createQueuedMessage(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: "queue_1",
    conversationId: "conv_1",
    content: "Queued follow-up",
    status: "pending",
    sortOrder: 0,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processingStartedAt: null,
    ...overrides
  };
}

const originalMatchMedia = window.matchMedia;

function mockViewportMatches(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 639px)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: originalMatchMedia
  });
});

describe("queued message banner", () => {
  it("renders queued pending items and exposes pending-item actions", () => {
    render(
      <QueuedMessageBanner
        items={[
          createQueuedMessage(),
          createQueuedMessage({
            id: "queue_2",
            content: "Processing follow-up",
            status: "processing"
          })
        ]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={vi.fn()}
      />
    );

    expect(screen.getByText("Queued follow-up")).toBeInTheDocument();
    expect(screen.getByText("Processing follow-up")).toBeInTheDocument();
    expect(screen.getAllByText(/^[12]$/)).toHaveLength(2);
    expect(screen.getByTestId("queued-message-body-queue_1").firstElementChild).toHaveTextContent(
      "1"
    );
    expect(screen.getByTestId("queued-message-body-queue_2").firstElementChild).toHaveTextContent(
      "2"
    );
    expect(screen.getByTestId("queued-message-body-queue_1").children).toHaveLength(3);
    expect(screen.getByTestId("queued-message-actions-queue_1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send now" })).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByText("Then 1")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByText("Send now")).toBeNull();
  });

  it("invokes onSendNow with the queued message id", () => {
    const onSendNow = vi.fn();

    render(
      <QueuedMessageBanner
        items={[createQueuedMessage({ id: "queue_send_now" })]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={onSendNow}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Send now" }));

    expect(onSendNow).toHaveBeenCalledWith("queue_send_now");
  });

  it("supports inline editing for pending items", () => {
    const onEdit = vi.fn();

    render(
      <QueuedMessageBanner
        items={[createQueuedMessage()]}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onSendNow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Queued follow-up"), {
      target: { value: "Edited follow-up" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onEdit).toHaveBeenCalledWith("queue_1", "Edited follow-up");
  });

  it("starts collapsed on mobile and toggles from the header", () => {
    mockViewportMatches(true);

    render(
      <QueuedMessageBanner
        items={[createQueuedMessage()]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={vi.fn()}
      />
    );

    const header = screen.getByRole("button", { name: "1 queued follow-up" });

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Queued follow-up")).toBeNull();

    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Queued follow-up")).toBeInTheDocument();
  });
});
