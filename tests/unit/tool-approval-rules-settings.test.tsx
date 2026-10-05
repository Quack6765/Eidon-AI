// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ToolApprovalRulesSettings } from "@/components/settings/integration-settings/tool-approval-rules-settings";
import type { ToolApprovalRule } from "@/lib/types";

const fetchMock = vi.fn();

function buildRule(overrides: Partial<ToolApprovalRule> = {}): ToolApprovalRule {
  return {
    id: "tar_1",
    userId: "user_1",
    scope: "shell",
    family: "git checkout",
    createdAt: "2026-04-12T08:00:00.000Z",
    ...overrides
  };
}

describe("tool approval rules settings", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("hides the add form and rules list while allow all tools is on", async () => {
    fetchMock.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return { ok: true, json: async () => ({ allowAll: true }) };
      }
      return { ok: true, json: async () => ({ allowAll: true, rules: [buildRule()] }) };
    });

    render(<ToolApprovalRulesSettings />);

    expect(await screen.findByRole("checkbox", { name: "Allow all tools" })).toBeChecked();
    expect(screen.queryByPlaceholderText("git checkout")).not.toBeInTheDocument();
    expect(screen.queryByText("git checkout")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("sends the allow-all setting when toggled and hides the list", async () => {
    fetchMock.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return { ok: true, json: async () => ({ allowAll: true }) };
      }
      return { ok: true, json: async () => ({ allowAll: false, rules: [buildRule()] }) };
    });

    render(<ToolApprovalRulesSettings />);
    const toggle = await screen.findByRole("checkbox", { name: "Allow all tools" });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tool-approvals",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ allowAll: true })
        })
      )
    );
    expect(screen.queryByPlaceholderText("git checkout")).not.toBeInTheDocument();
    expect(screen.queryByText("git checkout")).not.toBeInTheDocument();
    expect(await screen.findByText("All tools allowed.")).toBeInTheDocument();
  });

  it("adds a manual rule through the form and lists it", async () => {
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ rule: buildRule() }) };
      }
      return { ok: true, json: async () => ({ rules: [buildRule()] }) };
    });

    render(<ToolApprovalRulesSettings />);
    fireEvent.change(screen.getByPlaceholderText("git checkout"), {
      target: { value: "git checkout" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tool-approvals",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ command: "git checkout" })
        })
      )
    );
    expect(await screen.findByText("git checkout")).toBeInTheDocument();
    expect(await screen.findByText("Tool approval added.")).toBeInTheDocument();
  });

  it("surfaces validation errors from the server", async () => {
    fetchMock.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: false,
          json: async () => ({
            error: 'Enter a command prefix like "git" or "git checkout" using plain words only'
          })
        };
      }
      return { ok: true, json: async () => ({ rules: [] }) };
    });

    render(<ToolApprovalRulesSettings />);
    fireEvent.change(screen.getByPlaceholderText("git checkout"), {
      target: { value: "git; rm" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/plain words only/)).toBeInTheDocument();
  });

  it("revokes a rule from the list", async () => {
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (typeof input === "string" && input.startsWith("/api/tool-approvals/") && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({ rules: [buildRule()] }) };
    });

    render(<ToolApprovalRulesSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke git checkout" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tool-approvals/tar_1",
        expect.objectContaining({ method: "DELETE" })
      )
    );
  });
});
