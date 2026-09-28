// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  getMessageDraftHeading,
  isMessageDraftAction,
  MessageDraftCard
} from "@/components/message-draft-card";
import type { MessageDraftProposalPayload, MessageTimelineItem } from "@/lib/types";

type TimelineAction = Extract<MessageTimelineItem, { timelineKind: "action" }>;

function buildAction(
  overrides: {
    status?: TimelineAction["status"];
    proposalState?: TimelineAction["proposalState"];
    payload?: Partial<MessageDraftProposalPayload>;
  } = {}
) {
  const payload: MessageDraftProposalPayload = {
    operation: "message_draft",
    mcpServerId: "mcp_gmail",
    mcpServerName: "Gmail",
    mcpToolName: "send_email",
    toolLabel: "Send email",
    arguments: {
      to: ["sarah@example.com", "lee@example.com"],
      subject: "Q3 recap",
      body: "Hi Sarah,\n\nHere is the recap.",
      track_opens: false
    },
    fields: [
      { key: "to", label: "To", format: "list", required: true },
      { key: "subject", label: "Subject", format: "text", required: true },
      { key: "body", label: "Body", format: "multiline", required: true }
    ],
    ...overrides.payload
  };

  return {
    id: "act_draft",
    messageId: "msg_1",
    timelineKind: "action" as const,
    kind: "draft_message" as const,
    status: overrides.status ?? "pending",
    serverId: "mcp_gmail",
    skillId: null,
    toolName: "draft_message",
    label: "Message draft for Gmail",
    detail: "",
    arguments: null,
    resultSummary: "",
    sortOrder: 0,
    startedAt: "2026-09-25T08:00:00.000Z",
    completedAt: null,
    proposalState: overrides.proposalState === undefined ? "pending" : overrides.proposalState,
    proposalPayload: payload,
    proposalUpdatedAt: null
  } satisfies TimelineAction;
}

describe("MessageDraftCard", () => {
  it("recognizes draft actions and names every state honestly", () => {
    expect(isMessageDraftAction(buildAction())).toBe(true);
    expect(isMessageDraftAction({ ...buildAction(), proposalPayload: null })).toBe(false);
    expect(isMessageDraftAction({ ...buildAction(), kind: "create_memory" })).toBe(false);

    expect(getMessageDraftHeading(buildAction())).toBe("Ready to send");
    expect(getMessageDraftHeading(buildAction({ payload: { sendError: "Invalid recipient" } }))).toBe("Couldn't send");
    expect(getMessageDraftHeading(buildAction({ status: "running" }))).toBe("Sending...");
    expect(getMessageDraftHeading(buildAction({ status: "error" }))).toBe("Send interrupted");
    expect(getMessageDraftHeading(buildAction({ status: "completed", proposalState: "approved" }))).toBe("Sent");
    expect(getMessageDraftHeading(buildAction({ status: "completed", proposalState: "dismissed" }))).toBe("Discarded");
    expect(getMessageDraftHeading(buildAction({ status: "completed", proposalState: "superseded" }))).toBe(
      "Replaced by a newer draft"
    );
  });

  it("previews the message as it will be sent, including non-editable arguments", () => {
    render(<MessageDraftCard action={buildAction()} />);

    expect(screen.getByText("Ready to send")).toBeInTheDocument();
    expect(screen.getByText("Gmail · Send email")).toBeInTheDocument();
    expect(screen.getByText("sarah@example.com, lee@example.com")).toBeInTheDocument();
    expect(screen.getByText("Q3 recap")).toBeInTheDocument();
    expect(screen.getByTestId("message-draft-body")).toHaveTextContent("Here is the recap.");
    expect(screen.getByText("Also sent: track_opens: false")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("sends the draft unchanged when the user does not edit it", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageDraftCard action={buildAction()} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("act_draft", undefined));
  });

  it("sends the user's edits and restores the draft on cancel", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageDraftCard action={buildAction()} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Separate with commas")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Q3 recap")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Q3 recap");
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Shorter body" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("act_draft", {
        to: "sarah@example.com, lee@example.com",
        subject: "Q3 recap",
        body: "Shorter body"
      })
    );
  });

  it("shows request failures inline and keeps the draft actionable", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Gmail is not connected"));
    const onDiscard = vi.fn().mockRejectedValue("nope");
    render(<MessageDraftCard action={buildAction()} onSend={onSend} onDiscard={onDiscard} />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Gmail is not connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Unable to discard the draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("discards through the handler and falls back to a generic send error", async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    const onSend = vi.fn().mockRejectedValue("offline");
    render(<MessageDraftCard action={buildAction()} onSend={onSend} onDiscard={onDiscard} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith("act_draft"));

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Unable to send the draft")).toBeInTheDocument();
  });

  it("explains a connector failure and how to recover", () => {
    render(<MessageDraftCard action={buildAction({ payload: { sendError: "Invalid recipient" } })} />);

    expect(screen.getByText("Couldn't send")).toBeInTheDocument();
    expect(screen.getByText("Gmail didn't send it: Invalid recipient")).toBeInTheDocument();
    expect(screen.getByText("Edit the draft and send it again, or discard it.")).toBeInTheDocument();
  });

  it("shows resolved drafts without actions", () => {
    const { rerender } = render(
      <MessageDraftCard action={buildAction({ status: "completed", proposalState: "approved" })} />
    );
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();

    rerender(<MessageDraftCard action={buildAction({ status: "error" })} />);
    expect(screen.getByText(/may or may not have gone out/)).toBeInTheDocument();

    rerender(<MessageDraftCard action={buildAction()} readOnly />);
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("keeps the user's edits open after a failed send so they can fix and retry", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<MessageDraftCard action={buildAction()} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());

    rerender(
      <MessageDraftCard
        action={buildAction({
          payload: {
            sendError: "Invalid recipient",
            arguments: { to: ["sarah@example.com"], subject: "Edited", body: "Hi" }
          }
        })}
        onSend={onSend}
      />
    );

    expect(screen.getByText("Couldn't send")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("Edited");
    expect(screen.getByText("Gmail didn't send it: Invalid recipient")).toBeInTheDocument();
  });

  it("blocks sending while a required field is empty and explains why", () => {
    const onSend = vi.fn();
    render(<MessageDraftCard action={buildAction()} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: " , " } });

    expect(screen.getByText("To can't be empty.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "sarah@example.com" } });
    expect(screen.queryByText("To can't be empty.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("moves focus into the editor and back to Edit on cancel, with plain accessible names", () => {
    render(<MessageDraftCard action={buildAction()} onSend={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const to = screen.getByRole("textbox", { name: "To" });
    expect(to).toHaveFocus();
    expect(to).toHaveAccessibleDescription("Separate with commas");
    expect(screen.getByRole("textbox", { name: "Body" })).toHaveClass("overflow-y-hidden");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("links the empty-field explanation to Send and scrolls the body once the viewport caps it", () => {
    const originalHeight = window.innerHeight;
    render(<MessageDraftCard action={buildAction()} onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "" } });

    expect(screen.getByRole("status")).toHaveTextContent("To can't be empty.");
    expect(screen.getByRole("button", { name: "Send" })).toHaveAccessibleDescription("To can't be empty.");

    const body = screen.getByRole("textbox", { name: "Body" });
    expect(body).toHaveClass("overflow-y-hidden");
    expect(body).toHaveClass("transition-[border-color,background-color,box-shadow]");
    expect(body).not.toHaveClass("transition-all");
    act(() => {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 150 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(body).toHaveClass("overflow-y-auto");

    act(() => {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
      window.dispatchEvent(new Event("resize"));
    });
  });

  it("drops the discard hint from a failed draft while it is being edited", () => {
    render(<MessageDraftCard action={buildAction({ payload: { sendError: "Invalid recipient" } })} onSend={vi.fn()} />);
    expect(screen.getByText("Edit the draft and send it again, or discard it.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Gmail didn't send it: Invalid recipient")).toBeInTheDocument();
    expect(screen.queryByText("Edit the draft and send it again, or discard it.")).not.toBeInTheDocument();
  });

  it("keeps finished drafts at full contrast and drops stale request errors", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("no longer waiting"));
    const { container, rerender } = render(<MessageDraftCard action={buildAction()} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("no longer waiting")).toBeInTheDocument();

    rerender(<MessageDraftCard action={buildAction({ status: "completed", proposalState: "approved" })} onSend={onSend} />);
    expect(screen.queryByText("no longer waiting")).not.toBeInTheDocument();

    rerender(<MessageDraftCard action={buildAction({ status: "completed", proposalState: "dismissed" })} />);
    expect(container.querySelector(".opacity-60")).toBeNull();
  });

  it("labels body fields only when there are several and marks empty headers", () => {
    render(
      <MessageDraftCard
        action={buildAction({
          payload: {
            arguments: { title: "", summary: "Short summary", details: "Longer details" },
            fields: [
              { key: "title", label: "Title", format: "text", required: false },
              { key: "summary", label: "Summary", format: "multiline", required: false },
              { key: "details", label: "Details", format: "multiline", required: false }
            ]
          }
        })}
      />
    );

    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.queryByText(/Also sent/)).not.toBeInTheDocument();
  });

  it("offers Show more only when the body overflows its clamp", () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(160);

    render(<MessageDraftCard action={buildAction({ payload: { fields: [{ key: "body", label: "Body", format: "multiline", required: true }] } })} />);

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(screen.getByTestId("message-draft-body")).toHaveClass("line-clamp-8");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("message-draft-body")).not.toHaveClass("line-clamp-8");

    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });
});
