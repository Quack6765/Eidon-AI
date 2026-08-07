// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AutomationsSection } from "@/components/settings/sections/automations-section";

function buildAutomation() {
  return {
    id: "auto_1",
    name: "Morning summary",
    prompt: "Summarize priorities",
    providerProfileId: "profile_default",
    personaId: null,
    scheduleKind: "interval",
    intervalMinutes: 5,
    calendarFrequency: null,
    timeOfDay: null,
    daysOfWeek: [],
    enabled: true,
    nextRunAt: null,
    lastScheduledFor: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z"
  };
}

type FetchState = {
  postSaved?: boolean;
  rejectSave?: boolean;
  malformedAutomationReload?: boolean;
  postCount?: number;
  patchCount?: number;
};

function fetchState() {
  return global.fetch as unknown as FetchState;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

describe("automations section", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/automations" && method === "GET") {
        return {
          ok: true,
          json: async () => ({
            ...(fetchState().malformedAutomationReload && fetchState().postSaved
              ? {}
              : { automations: fetchState().postSaved ? [buildAutomation()] : [] })
          })
        } as Response;
      }

      if (url === "/api/settings") {
        return {
          ok: true,
          json: async () => ({
            settings: {
              defaultProviderProfileId: "profile_default",
              providerProfiles: [
                {
                  id: "profile_default",
                  name: "Default profile"
                }
              ]
            }
          })
        } as Response;
      }

      if (url === "/api/personas") {
        return {
          ok: true,
          json: async () => ({ personas: [] })
        } as Response;
      }

      if (url === "/api/automations" && method === "POST") {
        if (fetchState().rejectSave) {
          throw new Error("network down");
        }
        fetchState().postSaved = true;
        fetchState().postCount = (fetchState().postCount ?? 0) + 1;
        return {
          ok: true,
          json: async () => ({ automation: buildAutomation() })
        } as Response;
      }

      if (url === "/api/automations/auto_1" && method === "PATCH") {
        fetchState().patchCount = (fetchState().patchCount ?? 0) + 1;
        return {
          ok: true,
          json: async () => ({ automation: buildAutomation() })
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    }) as typeof fetch;
  });

  it("blocks saving intervals below five minutes", async () => {
    render(React.createElement(AutomationsSection));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add automation" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add automation" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Morning summary" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Summarize priorities" } });
    fireEvent.change(screen.getByLabelText("Every"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Interval must be at least 5 minutes")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/automations",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("shows a success message after saving an automation", async () => {
    render(React.createElement(AutomationsSection));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add automation" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add automation" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Morning summary" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Summarize priorities" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Automation saved.")).toBeInTheDocument();
    });

    const cancelButton = screen.getByRole("button", { name: "Discard" });
    const successMessage = screen.getByText("Automation saved.");
    expect(
      cancelButton.compareDocumentPosition(successMessage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows an error and keeps the unsaved switch dialog open when saving rejects", async () => {
    render(React.createElement(AutomationsSection));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add automation" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add automation" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Morning summary" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Summarize priorities" } });
    fetchState().rejectSave = true;

    fireEvent.click(screen.getByRole("button", { name: "Add automation" }));
    const dialog = screen.getByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to save automation");
    expect(alert).toHaveClass("z-[100]");
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Morning summary")).toBeInTheDocument();
  });

  it("retries a persisted creation as an update after reload validation fails", async () => {
    render(React.createElement(AutomationsSection));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add automation" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add automation" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Morning summary" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Summarize priorities" } });
    fetchState().malformedAutomationReload = true;

    fireEvent.click(screen.getAllByRole("button", { name: "Add automation" })[0]);
    let dialog = screen.getByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save automation");
    expect(fetchState().postCount).toBe(1);
    expect(fetchState().patchCount ?? 0).toBe(0);

    fetchState().malformedAutomationReload = false;
    dialog = screen.getByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(fetchState().postCount).toBe(1);
    expect(fetchState().patchCount).toBe(1);
  });

  it("does not show a redundant workspace shortcut in settings", async () => {
    render(React.createElement(AutomationsSection));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add automation" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Open automations workspace" })).toBeNull();
  });
});
