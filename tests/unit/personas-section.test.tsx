// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { PersonasSection } from "@/components/settings/sections/personas-section";
import type { Persona } from "@/lib/types";

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: "persona_created",
    name: "Canonical persona",
    content: "Canonical instructions",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("personas section", () => {
  it("uses the create response identity and sends later saves as PATCH", async () => {
    let postCount = 0;
    let patchCount = 0;
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "/api/personas" && !init?.method) {
        return { ok: true, json: async () => ({ personas: [] }) } as Response;
      }
      if (url === "/api/personas" && init?.method === "POST") {
        postCount += 1;
        return { ok: true, json: async () => ({ persona: makePersona() }) } as Response;
      }
      if (url === "/api/personas/persona_created" && init?.method === "PATCH") {
        patchCount += 1;
        return {
          ok: true,
          json: async () => ({ persona: makePersona({ name: "Canonical persona updated" }) })
        } as Response;
      }
      throw new Error(`Unhandled fetch ${String(init?.method ?? "GET")} ${url}`);
    }) as typeof fetch;
    render(React.createElement(PersonasSection));

    fireEvent.click(screen.getByRole("button", { name: "Add persona" }));
    fireEvent.change(screen.getByPlaceholderText("Persona name"), {
      target: { value: "Draft persona" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit system instructions" });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Draft instructions" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByDisplayValue("Canonical persona");
    fireEvent.change(screen.getByDisplayValue("Canonical persona"), {
      target: { value: "Edited again" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByDisplayValue("Canonical persona updated");
    expect(postCount).toBe(1);
    expect(patchCount).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps a dirty draft when a successful response is incomplete", async () => {
    global.fetch = vi.fn(async (input, init) => {
      if (String(input) === "/api/personas" && !init?.method) {
        return { ok: true, json: async () => ({ personas: [] }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
    render(React.createElement(PersonasSection));

    fireEvent.click(screen.getByRole("button", { name: "Add persona" }));
    fireEvent.change(screen.getByPlaceholderText("Persona name"), {
      target: { value: "Unsaved persona" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit system instructions" });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Unsaved instructions" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to create persona");
    expect(screen.getByDisplayValue("Unsaved persona")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());
  });
});
