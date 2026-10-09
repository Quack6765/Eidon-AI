// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ProviderConnectionFields } from "@/components/settings/provider-connection-fields";
import { ProviderDeviceCode } from "@/components/settings/provider-device-code";
import { ProviderUsageLimits } from "@/components/settings/provider-usage-limits";
import {
  createProviderProfileEditorDraft,
  type ProviderProfileEditorDraft
} from "@/lib/provider-profile-editor";

const { writeTextToClipboardMock } = vi.hoisted(() => ({ writeTextToClipboardMock: vi.fn() }));

vi.mock("@/lib/clipboard", () => ({ writeTextToClipboard: writeTextToClipboardMock }));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response);
}

function chatgptDraft(connection: Partial<ProviderProfileEditorDraft["connection"]> = {}) {
  const draft = createProviderProfileEditorDraft({ id: "profile_chatgpt", providerKind: "chatgpt_subscription" });
  return { ...draft, connection: { ...draft.connection, ...connection } };
}

const usage = {
  planLabel: "ChatGPT Plus",
  windows: [
    { label: "5-hour", usedPercent: 42.4, windowSeconds: 18000, resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString() },
    { label: "Weekly", usedPercent: 93, windowSeconds: 604800, resetsAt: new Date(Date.now() + 3 * 86400_000).toISOString() }
  ],
  fetchedAt: new Date().toISOString()
};

describe("device code sign-in", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the code, copies it, and counts down to expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
    const onCancel = vi.fn();
    writeTextToClipboardMock.mockResolvedValue(undefined);

    render(
      <ProviderDeviceCode
        providerLabel="ChatGPT subscription"
        onCancel={onCancel}
        flow={{
          flowId: "flow_1",
          userCode: "ABCD-1234",
          authorizationUrl: "https://auth.example/device",
          expiresAt: "2026-10-08T10:00:05.000Z"
        }}
      />
    );

    expect(screen.getByRole("group", { name: "Sign-in code ABCD-1234" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open sign-in page/ })).toHaveAttribute("href", "https://auth.example/device");
    expect(screen.getByRole("link", { name: /Open sign-in page/ })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Code expires in 0:05")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    });
    expect(writeTextToClipboardMock).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByRole("button", { name: "Code copied" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.getByText("Code expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows usage windows with reset times and refreshes on demand", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ usage }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProviderUsageLimits profileId="profile_chatgpt" />);

    const bars = await screen.findAllByRole("progressbar");
    expect(bars.map((bar) => [bar.getAttribute("aria-label"), bar.getAttribute("aria-valuenow")])).toEqual([
      ["5-hour usage", "42"],
      ["Weekly usage", "93"]
    ]);
    expect(screen.getByText("42% used")).toBeInTheDocument();
    expect(screen.getByText(/^Resets in 1h 59m|^Resets in 2h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/^Resets \w{3}/)).toBeInTheDocument();
    expect(screen.getByText("Updated just now")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh usage limits" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/providers/profile_chatgpt/usage", { signal: undefined });
  });

  it("explains empty and failed usage responses", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({ usage: { ...usage, windows: [] } }))
      .mockImplementationOnce(() => jsonResponse({ error: "The ChatGPT session has ended." }, 502));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProviderUsageLimits profileId="profile_chatgpt" />);

    expect(await screen.findByText("This plan did not report any usage limits.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage limits" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The ChatGPT session has ended.");
  });
});

describe("OAuth connection fields", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderFields(profile: ProviderProfileEditorDraft, overrides: Partial<React.ComponentProps<typeof ProviderConnectionFields>> = {}) {
    const props = {
      profile,
      models: [],
      dirty: false,
      onChange: vi.fn(),
      onSave: vi.fn(async () => true),
      onError: vi.fn(),
      ...overrides
    };
    render(<ProviderConnectionFields {...props} />);
    return props;
  }

  it("runs a device code sign-in until the connection succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let polls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/providers/profile_chatgpt/connection/flows" && init?.method === "POST") {
        return jsonResponse({
          flowId: "flow_1",
          userCode: "WXYZ-9876",
          authorizationUrl: "https://auth.example/device",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
        }, 201);
      }
      if (url === "/api/providers/profile_chatgpt/connection/flows/flow_1") {
        polls += 1;
        return jsonResponse({ flow: { status: polls > 1 ? "succeeded" : "pending" } });
      }
      if (url === "/api/settings") {
        return jsonResponse({
          settings: {
            providerProfiles: [{
              id: "profile_chatgpt",
              connection: { mode: "oauth", status: "connected", accountLabel: "owner@example.com · ChatGPT Plus", expiresAt: null }
            }]
          }
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const props = renderFields(chatgptDraft());
    expect(screen.getByText(/Private to the administrator who connects it/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT subscription" }));
    });
    expect(props.onSave).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Sign-in code WXYZ-9876" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("group", { name: "Sign-in code WXYZ-9876" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({ status: "connected", accountLabel: "owner@example.com · ChatGPT Plus" })
    })));
    expect(screen.queryByRole("group", { name: /Sign-in code/ })).toBeNull();
  });

  it("explains failed sign-ins and cancels without polling", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let flowStatus = "failed";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/connection/flows") && init?.method === "POST") {
        return jsonResponse({
          flowId: "flow_2",
          userCode: "AAAA-BBBB",
          authorizationUrl: "https://auth.example/device",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
        }, 201);
      }
      if (url.endsWith("/flows/flow_2")) return jsonResponse({ flow: { status: flowStatus } });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderFields(chatgptDraft());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT subscription" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in did not finish");

    flowStatus = "pending";
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT subscription" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/providers/profile_chatgpt/connection/flows/flow_2", { method: "DELETE" });
    const pollsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(fetchMock.mock.calls.length).toBe(pollsBefore);
    expect(screen.getByRole("button", { name: "Connect ChatGPT subscription" })).toBeInTheDocument();
  });

  it("shows why a sign-in could not start", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "Turn on device code login in ChatGPT." }, 400)));
    const props = renderFields(chatgptDraft());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT subscription" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Turn on device code login in ChatGPT.");
    expect(props.onError).not.toHaveBeenCalled();
  });

  it("shows usage and asks for a model choice once connected", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ usage })));
    const onChange = vi.fn();
    renderFields(
      chatgptDraft({ status: "connected", accountLabel: "owner@example.com · ChatGPT Plus" }),
      {
        models: [{ id: "gpt-6-luna", name: "GPT-6 Luna", maxContextWindowTokens: 400000 }],
        onChange
      }
    );

    expect(screen.getByText("Connected as owner@example.com · ChatGPT Plus")).toBeInTheDocument();
    expect(await screen.findAllByRole("progressbar")).toHaveLength(2);
    const select = screen.getByLabelText("Model");
    expect(within(select).getByRole("option", { name: "Choose a model" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "gpt-6-luna" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna", modelContextLimit: 400000 }));
  });

  it("flags expired sessions and keeps redirect sign-in for other providers", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      flowId: "flow_3",
      authorizationUrl: "https://github.example/authorize",
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    }, 201)));
    const draft = createProviderProfileEditorDraft({ id: "profile_copilot", providerKind: "github_copilot" });
    renderFields({ ...draft, connection: { ...draft.connection, status: "expired" } });

    expect(screen.getByText(/session has expired/)).toBeInTheDocument();
    expect(screen.queryByText(/Private to the administrator/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconnect GitHub Copilot" }));
    });
    expect(assign).toHaveBeenCalledWith("https://github.example/authorize");
  });
});
