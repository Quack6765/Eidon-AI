// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SavedLoginsSettings } from "@/components/settings/integration-settings/saved-logins-settings";
import { isSecretRequestAction, SecretRequestCard } from "@/components/secret-request-card";
import type { MessageTimelineItem, SecretRequestProposalPayload } from "@/lib/types";

type ActionItem = Extract<MessageTimelineItem, { timelineKind: "action" }>;

function secretAction(overrides: Partial<ActionItem> = {}) {
  return {
    id: "act_secret",
    messageId: "msg_1",
    timelineKind: "action",
    kind: "secret_request",
    status: "pending",
    serverId: null,
    skillId: null,
    toolName: null,
    label: "Enter your password",
    detail: "https://example.com",
    arguments: null,
    resultSummary: "",
    sortOrder: 0,
    startedAt: "2026-09-26T10:00:00.000Z",
    completedAt: null,
    proposalState: "pending",
    proposalPayload: { operation: "secret_request", label: "password", origin: "https://example.com", target: "@e5", save: true },
    proposalUpdatedAt: null,
    ...overrides
  } as ActionItem & { proposalPayload: SecretRequestProposalPayload };
}

describe("secret request card", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("asks for the secret in a masked field and sends it only to Eidon's fill endpoint", async () => {
    const card = secretAction();
    expect(isSecretRequestAction(card)).toBe(true);
    expect(isSecretRequestAction({ ...card, kind: "tool_approval" })).toBe(false);
    render(<SecretRequestCard action={card} />);

    expect(screen.getByText("Enter your password for example.com")).toBeInTheDocument();
    expect(screen.getByText(/won't send it to the model/)).toBeInTheDocument();
    const field = screen.getByLabelText("password");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
    const fill = screen.getByRole("button", { name: "Fill in" });
    expect(fill).toBeDisabled();
    const save = screen.getByRole("checkbox", { name: /Save it for example.com/ });
    expect(save).toBeChecked();

    fireEvent.change(field, { target: { value: "hunter22" } });
    fireEvent.click(save);
    fireEvent.click(fill);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/message-actions/act_secret/secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "hunter22", save: false })
    });
    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("shows why Eidon refused to type it, and declines on request", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "The bot's browser is on https://evil.example, not https://example.com, so Eidon didn't type it." }), { status: 409 })
    );
    render(<SecretRequestCard action={secretAction()} />);

    fireEvent.change(screen.getByLabelText("password"), { target: { value: "hunter22" } });
    fireEvent.submit(screen.getByLabelText("password").closest("form")!);
    expect(await screen.findByText(/not https:\/\/example.com, so Eidon didn't type it/)).toBeInTheDocument();
    expect(screen.getByLabelText("password")).toHaveValue("hunter22");

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/message-actions/act_secret/dismiss", expect.objectContaining({ method: "POST" })));
  });

  it("summarises an answered or read-only request without a field", () => {
    const { rerender } = render(
      <SecretRequestCard
        action={secretAction({
          status: "completed",
          proposalState: "approved",
          resultSummary: "Filled in",
          proposalPayload: { operation: "secret_request", label: "password", origin: "https://example.com", target: "@e5", save: true, resolution: "filled", saved: true }
        })}
      />
    );
    expect(screen.getByText("Filled in")).toBeInTheDocument();
    expect(screen.getByText("Typed into the page on https://example.com and saved for next time.")).toBeInTheDocument();
    expect(screen.queryByLabelText("password")).not.toBeInTheDocument();

    rerender(<SecretRequestCard action={secretAction()} readOnly />);
    expect(screen.getByText("The bot asked for your password on https://example.com.")).toBeInTheDocument();
  });

  it("lists saved logins without their values and removes them", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response("{}", { status: 200 })
        : new Response(
            JSON.stringify({
              savedLogins: fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")
                ? []
                : [{ id: "login_1", origin: "https://example.com", label: "password", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", lastUsedAt: "2026-09-03T00:00:00.000Z" }]
            }),
            { status: 200 }
          )
    );
    render(<SavedLoginsSettings />);

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(screen.getByText(/last filled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove the saved password for example.com" }));

    expect(await screen.findByText(/No saved logins yet/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/saved-logins/login_1", { method: "DELETE" });
  });
});
