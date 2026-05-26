// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

describe("ConfirmDialog", () => {
  it("renders title and description when open", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete persona?"
        description="This persona will be permanently deleted."
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("Delete persona?")).toBeInTheDocument();
    expect(screen.getByText("This persona will be permanently deleted.")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete persona?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete persona?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when backdrop is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete persona?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />
    );

    const backdrop = screen.getByRole("dialog").querySelector(".absolute.inset-0");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when Escape is pressed", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete persona?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not render when open is false", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Delete persona?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders custom confirmLabel when provided", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Remove item?"
        description="Are you sure?"
        onConfirm={vi.fn()}
        confirmLabel="Remove"
      />
    );

    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("renders default variant with primary styling when variant is default", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Confirm action?"
        description="Are you sure?"
        onConfirm={vi.fn()}
        variant="default"
        confirmLabel="Confirm"
      />
    );

    const confirmButton = screen.getByText("Confirm");
    expect(confirmButton).toBeInTheDocument();
    expect(confirmButton.className).toContain("bg-[var(--accent)]");
  });

  it("renders ReactNode description", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete persona?"
        description={
          <>
            <strong>My Persona</strong> will be permanently deleted.
          </>
        }
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("My Persona")).toBeInTheDocument();
    expect(screen.getByText("will be permanently deleted.")).toBeInTheDocument();
  });
});
