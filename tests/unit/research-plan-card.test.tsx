// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResearchPlanCard } from "@/components/research-plan-card";
import type { ResearchPlanDraft } from "@/hooks/use-research-plan-draft";

function renderCard(draft: Partial<ResearchPlanDraft> = {}) {
  const handlers = {
    onUpdateStep: vi.fn(),
    onAddStep: vi.fn(),
    onRemoveStep: vi.fn(),
    onMoveStep: vi.fn(),
    onRegenerate: vi.fn(),
    onCancel: vi.fn(),
    onStart: vi.fn()
  };
  const fullDraft: ResearchPlanDraft = {
    message: "Compare heat pump subsidies",
    plan: ["Find official pages", "Compare amounts"],
    updates: [],
    status: "ready",
    error: null,
    ...draft
  };
  render(React.createElement(ResearchPlanCard, { draft: fullDraft, ...handlers }));
  return handlers;
}

describe("ResearchPlanCard", () => {
  it("lists editable steps with move, remove, add, and start controls", () => {
    const handlers = renderCard();

    expect(screen.getByRole("region", { name: "Research plan" })).toHaveTextContent("Compare heat pump subsidies");
    expect(screen.getByLabelText("Research step 1")).toHaveValue("Find official pages");

    fireEvent.change(screen.getByLabelText("Research step 2"), { target: { value: "Compare amounts by country" } });
    expect(handlers.onUpdateStep).toHaveBeenCalledWith(1, "Compare amounts by country");

    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move step 1 down" }));
    expect(handlers.onMoveStep).toHaveBeenCalledWith(0, 1);
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    expect(handlers.onMoveStep).toHaveBeenCalledWith(1, -1);
    expect(screen.getByRole("button", { name: "Move step 2 down" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove step 2" }));
    expect(handlers.onRemoveStep).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(handlers.onAddStep).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    expect(handlers.onRegenerate).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start research" }));
    expect(handlers.onStart).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onCancel).toHaveBeenCalled();
    expect(screen.getByText("2 of 12 steps")).toBeInTheDocument();
  });

  it("disables editing while drafting and blocks invalid plans", () => {
    renderCard({ status: "loading", plan: [] });
    expect(screen.getByText("Drafting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start research" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeDisabled();
  });

  it("explains invalid plans and shows generation errors", () => {
    renderCard({ plan: ["Find pages", "   "], status: "error", error: "The research plan could not be generated" });

    expect(screen.getByRole("button", { name: "Start research" })).toBeDisabled();
    expect(screen.getByText(/Use 1 to 12 non-empty steps/)).toBeInTheDocument();
    expect(screen.getByText(/could not be generated/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove step 1" })).toBeEnabled();
  });

  it("keeps at least one step", () => {
    renderCard({ plan: ["Only step"] });

    expect(screen.getByRole("button", { name: "Remove step 1" })).toBeDisabled();
  });

  it("lists applied update instructions", () => {
    renderCard({ updates: ["Focus on pricing", "Add a step about availability"] });

    const updates = screen.getByRole("list", { name: "Plan updates" });
    expect(within(updates).getAllByRole("listitem")).toHaveLength(2);
    expect(within(updates).getByText("You: Focus on pricing")).toBeInTheDocument();
    expect(within(updates).getByText("You: Add a step about availability")).toBeInTheDocument();
  });

  it("shows an updating state that keeps the plan editable-disabled", () => {
    renderCard({ status: "updating", updates: ["Focus on pricing"] });

    expect(screen.getByText("Updating")).toBeInTheDocument();
    expect(screen.getByLabelText("Research step 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start research" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeDisabled();
  });

  it("keeps the plan and lists the instruction when a refinement fails", () => {
    renderCard({ status: "error", error: "The plan could not be updated", updates: ["Focus on pricing"] });

    expect(screen.getByText(/The plan could not be updated/)).toBeInTheDocument();
    expect(screen.getByLabelText("Research step 1")).toHaveValue("Find official pages");
    expect(screen.getByRole("list", { name: "Plan updates" })).toHaveTextContent("You: Focus on pricing");
    expect(screen.getByRole("button", { name: "Start research" })).toBeEnabled();
  });
});
