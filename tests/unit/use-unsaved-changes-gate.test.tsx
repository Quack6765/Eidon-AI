// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useUnsavedChangesGate } from "@/hooks/use-unsaved-changes-gate";
import { registerUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";

function Harness({ action }: { action: () => void }) {
  const { gate, dialog } = useUnsavedChangesGate();
  return (
    <div>
      <button type="button" onClick={() => gate(action)}>Go</button>
      {dialog}
    </div>
  );
}

describe("useUnsavedChangesGate", () => {
  afterEach(() => {
    cleanup();
    registerUnsavedChangesGuard(null);
  });

  it("runs the action immediately when no guard is registered", () => {
    registerUnsavedChangesGuard(null);
    const action = vi.fn();

    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("runs the action immediately when the guard is not dirty", () => {
    registerUnsavedChangesGuard({
      isDirty: () => false,
      save: vi.fn(),
      discard: vi.fn(),
      entityType: "these settings"
    });
    const action = vi.fn();

    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("defers the action and shows the dialog when the guard is dirty", () => {
    registerUnsavedChangesGuard({
      isDirty: () => true,
      save: vi.fn().mockResolvedValue(true),
      discard: vi.fn(),
      entityType: "these settings"
    });
    const action = vi.fn();

    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("runs the deferred action after a successful save", async () => {
    const save = vi.fn().mockResolvedValue(true);
    registerUnsavedChangesGuard({
      isDirty: () => true,
      save,
      discard: vi.fn(),
      entityType: "these settings"
    });
    const action = vi.fn();

    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open when save returns false", async () => {
    const save = vi.fn().mockResolvedValue(false);
    registerUnsavedChangesGuard({
      isDirty: () => true,
      save,
      discard: vi.fn(),
      entityType: "these settings"
    });
    const action = vi.fn();

    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });

  it("keeps the dialog open when save rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("network down"));
    registerUnsavedChangesGuard({
      isDirty: () => true,
      save,
      discard: vi.fn(),
      entityType: "these settings"
    });
    const action = vi.fn();

    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });

  it("runs the deferred action after discarding", () => {
    const discard = vi.fn();
    registerUnsavedChangesGuard({
      isDirty: () => true,
      save: vi.fn(),
      discard,
      entityType: "these settings"
    });
    const action = vi.fn();

    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    fireEvent.click(screen.getByRole("button", { name: /don't save/i }));

    expect(discard).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
