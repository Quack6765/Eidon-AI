// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MemoriesSection } from "@/components/settings/sections/memories-section";
import type { UserMemory } from "@/lib/types";

function buildMemory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    id: "mem_1",
    content: "Prefers concise summaries",
    category: "preference",
    pinned: false,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function mockEndpoints(memories: UserMemory[]) {
  const current = [...memories];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.startsWith("/api/memories?") || url === "/api/memories") {
      return { ok: true, json: async () => ({ memories: current }) } as Response;
    }
    if (url.startsWith("/api/memories/") && method === "PATCH") {
      const id = url.slice("/api/memories/".length);
      const body = JSON.parse(String(init?.body)) as Partial<UserMemory>;
      const index = current.findIndex((memory) => memory.id === id);
      current[index] = { ...current[index], ...body };
      return { ok: true, json: async () => ({ memory: current[index] }) } as Response;
    }
    throw new Error(`Unexpected fetch ${method} ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("memories section pinning", () => {
  it("pins a memory through the PATCH endpoint and shows the pinned indicator", async () => {
    const fetchMock = mockEndpoints([buildMemory()]);

    render(<MemoriesSection />);

    const pinButton = await screen.findByRole("button", { name: "Pin memory" });
    expect(pinButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.getByText("Pinned memories are always included in the prompt.")).toBeInTheDocument();

    fireEvent.click(pinButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unpin memory" })).toBeInTheDocument();
    });
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patchCall[0]).toBe("/api/memories/mem_1");
    expect(JSON.parse(String(patchCall[1]?.body))).toEqual({ pinned: true });
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin memory" })).toHaveAttribute("aria-pressed", "true");
  });

  it("unpins a pinned memory", async () => {
    const fetchMock = mockEndpoints([buildMemory({ pinned: true })]);

    render(<MemoriesSection />);

    expect(await screen.findByText("Pinned")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unpin memory" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pin memory" })).toBeInTheDocument();
    });
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patchCall[1]?.body))).toEqual({ pinned: false });
    expect(screen.queryByText("Pinned")).toBeNull();
  });
});
