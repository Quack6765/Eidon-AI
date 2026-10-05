// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";

import { NotificationsSection } from "@/components/settings/sections/notifications-section";

const LOCAL_ENDPOINT = "https://push.example.com/local-sub";

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload
  } as Response;
}

function stubServiceWorker(subscription: { endpoint: string } | null) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () =>
        subscription
          ? { pushManager: { getSubscription: async () => subscription } }
          : undefined
    }
  });
}

function mockFetch(subscriptions: Array<{ id: string; endpoint: string }>) {
  global.fetch = vi.fn(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/push/vapid") {
      return jsonResponse({ publicKey: "public-key" });
    }
    if (url === "/api/push/subscribe") {
      return jsonResponse({ subscriptions });
    }
    if (url === "/api/pushover") {
      return jsonResponse({ configured: false });
    }
    throw new Error(`Unhandled fetch: ${url}`);
  }) as typeof fetch;
}

function subscriptionRow(endpoint: string) {
  return {
    id: `sub_${endpoint}`,
    endpoint,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSuccessAt: null,
    lastErrorAt: null
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("notifications section push state", () => {
  it("shows the enable action when this browser is not subscribed", async () => {
    mockFetch([]);
    stubServiceWorker(null);

    render(<NotificationsSection />);

    expect(
      await screen.findByRole("button", { name: "Enable push on this browser" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
  });

  it("shows the enabled status row when this browser is subscribed", async () => {
    mockFetch([subscriptionRow(LOCAL_ENDPOINT)]);
    stubServiceWorker({ endpoint: LOCAL_ENDPOINT });

    render(<NotificationsSection />);

    await waitFor(() => {
      expect(screen.getByText("Enabled")).toBeInTheDocument();
    });
    expect(
      screen.getByText("This browser receives OS notifications for your automation runs.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enable push on this browser" })
    ).not.toBeInTheDocument();
  });

  it("shows the enable action when only other browsers are subscribed", async () => {
    mockFetch([subscriptionRow("https://push.example.com/other-device")]);
    stubServiceWorker({ endpoint: LOCAL_ENDPOINT });

    render(<NotificationsSection />);

    expect(
      await screen.findByRole("button", { name: "Enable push on this browser" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
  });
});
