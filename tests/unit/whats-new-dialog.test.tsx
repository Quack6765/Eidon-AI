// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAYLOAD = {
  version: "v4.1.0",
  autoOpen: true,
  bullets: ["Get a Pushover notification when an automation finishes", "Mistral is a new provider"]
};

function stubFetch(whatsNew: unknown) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ seenReleaseVersion: PAYLOAD.version }), { status: 200 });
    }

    return new Response(JSON.stringify({ whatsNew }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function seenRequests(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
}

describe("WhatsNewDialog", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists every highlight and the release it belongs to", async () => {
    stubFetch(PAYLOAD);
    const { WhatsNewDialog } = await import("@/components/whats-new-dialog");

    render(<WhatsNewDialog open={true} onOpenChange={vi.fn()} />);

    expect(await screen.findByText("What's new")).toBeInTheDocument();
    expect(screen.getByText("v4.1.0")).toBeInTheDocument();
    for (const bullet of PAYLOAD.bullets) {
      expect(screen.getByText(bullet)).toBeInTheDocument();
    }
  });

  it("renders nothing when there are no authored highlights", async () => {
    stubFetch(null);
    const { WhatsNewDialog } = await import("@/components/whats-new-dialog");

    const { container } = render(<WhatsNewDialog open={true} onOpenChange={vi.fn()} />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("records the release as seen exactly once when acknowledged", async () => {
    const fetchMock = stubFetch(PAYLOAD);
    const onOpenChange = vi.fn();
    const { WhatsNewDialog } = await import("@/components/whats-new-dialog");

    render(<WhatsNewDialog open={true} onOpenChange={onOpenChange} />);
    const button = await screen.findByRole("button", { name: "Got it" });

    await userEvent.click(button);

    await waitFor(() => expect(seenRequests(fetchMock)).toHaveLength(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not re-record a release that is only being re-read", async () => {
    const fetchMock = stubFetch({ ...PAYLOAD, autoOpen: false });
    const { WhatsNewDialog } = await import("@/components/whats-new-dialog");

    render(<WhatsNewDialog open={true} onOpenChange={vi.fn()} />);
    await screen.findByText("What's new");

    expect(seenRequests(fetchMock)).toHaveLength(0);
  });
});

describe("WhatsNewVersionButton", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_APP_VERSION = "dev-abc1234";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  });

  it("keeps showing the running build while offering the highlights on demand", async () => {
    stubFetch({ ...PAYLOAD, autoOpen: false });
    const { WhatsNewVersionButton } = await import("@/components/whats-new-dialog");

    render(<WhatsNewVersionButton />);

    const button = await screen.findByRole("button", { name: "dev-abc1234" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");

    await userEvent.click(button);
    expect(await screen.findByText(PAYLOAD.bullets[0])).toBeInTheDocument();
    expect(screen.getByText(PAYLOAD.version)).toBeInTheDocument();
  });

  it("falls back to a plain label when there is nothing authored", async () => {
    stubFetch(null);
    const { WhatsNewVersionButton } = await import("@/components/whats-new-dialog");

    render(<WhatsNewVersionButton />);

    await waitFor(() => expect(screen.queryByRole("button")).not.toBeInTheDocument());
    expect(screen.getByText("dev-abc1234")).toBeInTheDocument();
  });

  it("records the dismissal once across repeated reads", async () => {
    const fetchMock = stubFetch({ ...PAYLOAD, autoOpen: false });
    const { WhatsNewVersionButton } = await import("@/components/whats-new-dialog");

    render(<WhatsNewVersionButton />);
    const button = await screen.findByRole("button", { name: "dev-abc1234" });

    await userEvent.click(button);
    await userEvent.click(await screen.findByRole("button", { name: "Got it" }));
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole("button", { name: "Got it" }));

    await waitFor(() => expect(seenRequests(fetchMock)).toHaveLength(1));
  });
});

describe("WhatsNewAutoDialog", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens by itself for an unseen release", async () => {
    stubFetch(PAYLOAD);
    const { WhatsNewAutoDialog } = await import("@/components/whats-new-dialog");

    render(<WhatsNewAutoDialog />);

    expect(await screen.findByText(PAYLOAD.bullets[0])).toBeInTheDocument();
  });

  it("stays closed when the release has already been seen or is not a release build", async () => {
    stubFetch({ ...PAYLOAD, autoOpen: false });
    const { WhatsNewAutoDialog } = await import("@/components/whats-new-dialog");

    const { container } = render(<WhatsNewAutoDialog />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(PAYLOAD.bullets[0])).not.toBeInTheDocument();
  });

  it("survives a failed request without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const { WhatsNewAutoDialog } = await import("@/components/whats-new-dialog");

    const { container } = render(<WhatsNewAutoDialog />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
