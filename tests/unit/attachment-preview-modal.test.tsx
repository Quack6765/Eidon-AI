// @vitest-environment jsdom

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttachmentPreviewModal, type AttachmentPreviewState } from "@/components/attachment-preview-modal";

const attachment = {
  id: "att_1",
  filename: "quarterly-revenue-breakdown-by-region-final.csv",
  mimeType: "text/csv",
  kind: "text" as const,
  byteSize: 10,
  createdAt: "2026-09-25T00:00:00.000Z"
};

function Harness({ state }: { state: AttachmentPreviewState }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open preview
      </button>
      {open ? (
        <AttachmentPreviewModal attachment={attachment} state={state} onClose={() => setOpen(false)} onRetry={() => {}} />
      ) : null}
    </>
  );
}

function openPreview(state: AttachmentPreviewState) {
  render(<Harness state={state} />);
  const trigger = screen.getByRole("button", { name: "Open preview" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

describe("AttachmentPreviewModal", () => {
  it("moves focus into the dialog and returns it to the trigger when closed", () => {
    const trigger = openPreview({ kind: "text", content: "a,b" });

    expect(screen.getByRole("button", { name: "Close attachment preview" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close attachment preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab focus inside the dialog", () => {
    openPreview({ kind: "error", message: "Unable to load attachment preview." });
    const close = screen.getByRole("button", { name: "Close attachment preview" });
    const retry = screen.getByRole("button", { name: "Retry preview" });

    retry.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(retry).toHaveFocus();

    screen.getByRole("link", { name: "Download attachment" }).focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("link", { name: "Download attachment" })).toHaveFocus();

    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("closes on Escape, shows the full file name on hover, and sits above in-page overlays", () => {
    openPreview({ kind: "text", content: "a,b" });

    expect(screen.getByText(attachment.filename)).toHaveAttribute("title", attachment.filename);
    expect(screen.getByRole("dialog").parentElement).toHaveClass("z-[60]");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
