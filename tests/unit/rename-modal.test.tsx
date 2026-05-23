// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RenameModal } from "@/components/ui/rename-modal";

describe("RenameModal", () => {
  it("renders with the current value pre-filled in the input", () => {
    render(
      <RenameModal
        open={true}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    const input = screen.getByDisplayValue("My Conversation");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
    expect(screen.getByText("Rename conversation")).toBeInTheDocument();
  });

  it("calls onSave with trimmed value when Save is clicked", () => {
    const onSave = vi.fn();
    render(
      <RenameModal
        open={true}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={onSave}
        title="Rename conversation"
      />
    );

    const input = screen.getByDisplayValue("My Conversation");
    fireEvent.change(input, { target: { value: "  New Title  " } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith("New Title");
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <RenameModal
        open={true}
        onOpenChange={onOpenChange}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when backdrop is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <RenameModal
        open={true}
        onOpenChange={onOpenChange}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    const backdrop = screen.getByRole("dialog").querySelector(".absolute.inset-0");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables Save when input is empty or whitespace-only", () => {
    render(
      <RenameModal
        open={true}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    const input = screen.getByDisplayValue("My Conversation");
    const saveButton = screen.getByText("Save");

    expect(saveButton).toBeEnabled();

    fireEvent.change(input, { target: { value: "   " } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "" } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "a" } });
    expect(saveButton).toBeEnabled();
  });

  it("does not render when open is false", () => {
    render(
      <RenameModal
        open={false}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
