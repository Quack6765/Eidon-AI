// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  AutomationProposalCard,
  getAutomationProposalHeading,
  isAutomationProposalAction
} from "@/components/automation-proposal-card";
import type { AutomationProposalPayload, MessageTimelineItem } from "@/lib/types";

function buildAction(overrides: {
  proposalState?: string | null;
  status?: string;
  payload?: Partial<AutomationProposalPayload>;
} = {}) {
  const payload: AutomationProposalPayload = {
    name: "Morning brief",
    prompt: "Summarize the news.\nBe thorough and cite {{date}}.",
    scheduleKind: "calendar",
    intervalMinutes: null,
    calendarFrequency: "weekly",
    timeOfDay: "08:30",
    daysOfWeek: [1, 3],
    providerProfileId: "profile_default",
    personaId: null,
    continuePreviousConversation: true,
    automationId: "auto_123",
    ...overrides.payload
  };

  return {
    id: "act_auto",
    messageId: "msg_1",
    timelineKind: "action" as const,
    kind: "create_automation" as const,
    status: (overrides.status ?? "pending") as "pending",
    serverId: null,
    skillId: null,
    toolName: null,
    label: "Automation proposal",
    detail: "Morning brief",
    arguments: null,
    resultSummary: "",
    sortOrder: 0,
    startedAt: "2026-04-12T08:00:00.000Z",
    completedAt: null,
    proposalState: (overrides.proposalState ?? "pending") as "pending",
    proposalPayload: payload,
    proposalUpdatedAt: null
  };
}

function mockSettingsFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: { providerProfiles: [{ id: "profile_default", name: "Main profile" }] }
      })
    })
  );
}

describe("AutomationProposalCard", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockSettingsFetch();
  });

  it("renders the name, schedule, continuity, provider, and full prompt while pending", async () => {
    render(<AutomationProposalCard action={buildAction()} />);

    expect(screen.getByText("Morning brief")).toBeTruthy();
    expect(screen.getByText(/Mon, Wed at 08:30/)).toBeTruthy();
    expect(
      screen.getByText(/Each run continues the previous run's conversation/)
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/Runs with Main profile/)).toBeTruthy();
    });
    expect(screen.getByText(/Summarize the news/)).toBeTruthy();
    expect(screen.getByText(/\{\{date\}\}/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ignore" })).toBeTruthy();
  });

  it("shows a fresh-conversation indicator when continuity is off", () => {
    render(
      <AutomationProposalCard
        action={buildAction({ payload: { continuePreviousConversation: false } })}
      />
    );

    expect(screen.getByText(/Each run starts a fresh conversation/)).toBeTruthy();
  });

  it("approves with prompt overrides after editing", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<AutomationProposalCard action={buildAction()} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByLabelText("Automation prompt");
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, {
      target: { value: "Edited prompt for {{date}}." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith("act_auto", { prompt: "Edited prompt for {{date}}." });
    });
  });

  it("approves without overrides when the prompt was not edited", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<AutomationProposalCard action={buildAction()} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith("act_auto", undefined);
    });
  });

  it("dismisses through the ignore button", async () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(<AutomationProposalCard action={buildAction()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledWith("act_auto");
    });
  });

  it("shows a local error when approval fails", async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error("Provider profile not found"));
    render(<AutomationProposalCard action={buildAction()} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      expect(screen.getByText("Provider profile not found")).toBeTruthy();
    });
  });

  it("renders read-only without action buttons", () => {
    render(<AutomationProposalCard action={buildAction()} readOnly />);

    expect(screen.queryByRole("button", { name: "Schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ignore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByText(/Summarize the news/)).toBeTruthy();
  });

  it("links to the automation workspace once approved", () => {
    render(<AutomationProposalCard action={buildAction({ proposalState: "approved", status: "completed" })} />);

    const link = screen.getByRole("link", { name: /View in Automations workspace/ });
    expect(link.getAttribute("href")).toBe("/automations/auto_123");
    expect(screen.queryByRole("button", { name: "Schedule" })).toBeNull();
  });

  it("marks dismissed and error states in the heading", () => {
    expect(getAutomationProposalHeading(buildAction({ proposalState: "dismissed", status: "completed" }))).toBe(
      "Automation ignored"
    );
    expect(getAutomationProposalHeading(buildAction({ status: "error" }))).toBe(
      "Automation not scheduled"
    );
    expect(getAutomationProposalHeading(buildAction())).toBe("Schedule automation");
  });

  it("detects automation proposal actions", () => {
    const action = buildAction();
    expect(isAutomationProposalAction(action as Extract<MessageTimelineItem, { timelineKind: "action" }>)).toBe(true);

    const memoryAction = {
      ...action,
      kind: "create_memory" as const,
      proposalPayload: { operation: "create", targetMemoryId: null }
    };
    expect(isAutomationProposalAction(memoryAction as Extract<MessageTimelineItem, { timelineKind: "action" }>)).toBe(false);
  });
});
