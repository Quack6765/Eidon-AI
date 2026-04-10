// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AutomationsSection } from "@/components/settings/sections/automations-section";

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
            automations:
              (global.fetch as unknown as { postSaved?: boolean }).postSaved
                ? [
                    {
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
                    }
                  ]
                : []
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
        (global.fetch as unknown as { postSaved?: boolean }).postSaved = true;
        return {
          ok: true,
          json: async () => ({
            automation: {
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
            }
          })
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
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }));

    await waitFor(() => {
      expect(screen.getByText("Automation saved.")).toBeInTheDocument();
    });

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const successMessage = screen.getByText("Automation saved.");
    expect(
      cancelButton.compareDocumentPosition(successMessage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("does not show a redundant workspace shortcut in settings", async () => {
    render(React.createElement(AutomationsSection));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add automation" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Open automations workspace" })).toBeNull();
  });
});
