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
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send now" })).toBeInTheDocument();
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
});
