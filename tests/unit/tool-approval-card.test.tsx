// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  isToolApprovalAction,
  ToolApprovalCard
} from "@/components/tool-approval-card";
import type { MessageTimelineItem, ToolApprovalProposalPayload } from "@/lib/types";

function buildAction(overrides: {
  status?: string;
  proposalState?: string | null;
  payload?: Partial<ToolApprovalProposalPayload>;
} = {}) {
  const payload: ToolApprovalProposalPayload = {
    operation: "tool_approval",
    scope: "shell",
    families: ["curl"],
    classified: true,
    command: "curl https://example.com -X POST -d @payload.json",
    ...overrides.payload
  };

  return {
    id: "act_tool",
    messageId: "msg_1",
    timelineKind: "action" as const,
    kind: "tool_approval" as const,
    status: (overrides.status ?? "pending") as "pending",
    serverId: null,
    skillId: null,
    toolName: null,
    label: 'Allow "curl" commands?',
    detail: payload.command ?? "",
    arguments: null,
    resultSummary: "",
    sortOrder: 0,
    startedAt: "2026-04-12T08:00:00.000Z",
    completedAt: null,
    proposalState: (overrides.proposalState ?? "pending") as "pending",
    proposalPayload: payload,
    proposalUpdatedAt: null
  } satisfies Extract<MessageTimelineItem, { timelineKind: "action" }>;
}

describe("ToolApprovalCard", () => {
  it("recognizes tool approval actions", () => {
    expect(isToolApprovalAction(buildAction())).toBe(true);
  });

  it("asks for the command family and offers allow once, allow always, and deny", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(
      <ToolApprovalCard
        action={buildAction()}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText('Allow "curl" commands?')).toBeInTheDocument();
    expect(
      screen.getByText("curl https://example.com -X POST -d @payload.json")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Approving allows the "curl" command family — every such command, whatever its arguments.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Allow always" }));
    expect(onApprove).toHaveBeenCalledWith("act_tool", { allowAlways: true });

    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));
    expect(onApprove).toHaveBeenCalledWith("act_tool", { allowAlways: false });

    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));
    expect(onDismiss).toHaveBeenCalledWith("act_tool");
  });

  it("does not offer allow always for unclassified commands", () => {
    render(
      <ToolApprovalCard
        action={buildAction({
          payload: {
            families: [],
            classified: false,
            command: "echo $(hostname)"
          }
        })}
      />
    );

    expect(screen.getByText("Allow this command?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow always" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
  });

  it("shows resolved states without buttons", () => {
    const { rerender } = render(
      <ToolApprovalCard
        action={buildAction({
          status: "completed",
          proposalState: "approved",
          payload: { resolution: "always" }
        })}
      />
    );

    expect(screen.getByText("Always allowed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Approving allows/)
    ).not.toBeInTheDocument();

    rerender(
      <ToolApprovalCard
        action={buildAction({
          status: "completed",
          proposalState: "dismissed",
          payload: { resolution: "expired" }
        })}
      />
    );
    expect(screen.getByText("Request expired")).toBeInTheDocument();
  });

  it("renders MCP tool approvals with tool and server names", () => {
    render(
      <ToolApprovalCard
        action={buildAction({
          payload: {
            scope: "mcp",
            families: ["github:create_issue"],
            classified: true,
            command: undefined,
            mcpServerId: "srv_1",
            mcpServerName: "GitHub",
            mcpToolName: "create_issue",
            arguments: { repo: "eidon" }
          }
        })}
      />
    );

    expect(
      screen.getByText('Allow "create_issue" from GitHub?')
    ).toBeInTheDocument();
    expect(screen.getByText(/"repo": "eidon"/)).toBeInTheDocument();
  });
});
