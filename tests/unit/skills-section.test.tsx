// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { SkillsSection } from "@/components/settings/sections/skills-section";
import { getUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";
import type { Skill } from "@/lib/types";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_1",
    name: "Draft Skill",
    description: "Draft description",
    content: "Draft instructions",
    enabled: true,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

async function fillNewSkill(input: {
  name?: string;
  description?: string;
  content?: string;
  enabled?: boolean;
} = {}) {
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  fireEvent.change(screen.getByPlaceholderText("Skill name"), {
    target: { value: input.name ?? "Draft Skill" }
  });
  fireEvent.change(screen.getByPlaceholderText("Explain when this skill should and should not trigger"), {
    target: { value: input.description ?? "Draft description" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog", { name: "Edit instructions" });
  fireEvent.change(within(dialog).getByPlaceholderText("Enter the full skill instructions..."), {
    target: { value: input.content ?? "Draft instructions" }
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

  if (input.enabled === false) {
    fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
  }

  await waitFor(() => expect(getUnsavedChangesGuard()).not.toBeNull());
}

describe("skills section", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("returns false, shows an error, and preserves the draft when saving rejects", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] })
      } as Response)
      .mockRejectedValueOnce(new Error("network down"));

    render(React.createElement(SkillsSection));
    await screen.findByText("0 skills");
    await fillNewSkill();

    let result: boolean | void | undefined;
    await act(async () => {
      result = await getUnsavedChangesGuard()?.save();
    });

    expect(result).toBe(false);
    expect(screen.getByText("Failed to save skill.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Draft Skill")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("creates a disabled skill in one write without a follow-up patch", async () => {
    const created = makeSkill({ enabled: false });
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/skills" && method === "GET") {
        const postCount = vi.mocked(global.fetch).mock.calls.filter(([, request]) => request?.method === "POST").length;
        return {
          ok: true,
          json: async () => ({ skills: postCount > 0 ? [created] : [] })
        } as Response;
      }

      if (url === "/api/skills" && method === "POST") {
        return {
          ok: true,
          json: async () => ({ skill: created })
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    render(React.createElement(SkillsSection));
    await screen.findByText("0 skills");
    await fillNewSkill({ enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Skill saved.")).toBeInTheDocument();
    const postCall = vi.mocked(global.fetch).mock.calls.find(([, init]) => init?.method === "POST");
    const postBody = JSON.parse(String(postCall?.[1]?.body));
    expect(postBody.enabled).toBe(false);
    expect(vi.mocked(global.fetch).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Enabled" })).not.toBeChecked();
  });

  it("does not report success when reloading the saved skill fails", async () => {
    const created = makeSkill();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skill: created })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "reload failed" })
      } as Response);

    render(React.createElement(SkillsSection));
    await screen.findByText("0 skills");
    await fillNewSkill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save skill.")).toBeInTheDocument();
    expect(screen.queryByText("Skill saved.")).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("uses the reloaded server-normalized skill as the clean baseline", async () => {
    const created = makeSkill();
    const normalized = makeSkill({
      name: "Normalized Skill",
      description: "Normalized description",
      content: "Normalized instructions"
    });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skill: created })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [normalized] })
      } as Response);

    render(React.createElement(SkillsSection));
    await screen.findByText("0 skills");
    await fillNewSkill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Skill saved.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Normalized Skill")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Normalized description")).toBeInTheDocument();
    expect(screen.getByText("Normalized instructions")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    await waitFor(() => expect(getUnsavedChangesGuard()).toBeNull());
  });
});
