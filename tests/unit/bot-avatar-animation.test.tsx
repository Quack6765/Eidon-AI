// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { BotAvatar } from "@/components/agents/bot-avatar";

const SAFE_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g class="vb-head"><use href="#head"/></g></svg>';

function stubMarkup(body: string, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, text: async () => body } as Response)
  );
}

function animState(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-anim]")?.dataset.anim ?? null;
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("BotAvatar animation", () => {
  it("renders a plain image when no status is supplied", async () => {
    stubMarkup(SAFE_MARKUP);
    render(<BotAvatar seed="seed_plain" size={40} />, { container });

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(animState(container)).toBeNull();
  });

  it("plays the animation only while the bot is running", async () => {
    stubMarkup(SAFE_MARKUP);
    const { rerender } = render(<BotAvatar seed="seed_run" size={40} status="idle" />, {
      container
    });

    await waitFor(() => expect(animState(container)).toBe("off"));
    expect(container.querySelector("img")).toBeNull();

    rerender(<BotAvatar seed="seed_run" size={40} status="running" />);
    await waitFor(() => expect(animState(container)).toBe("on"));

    rerender(<BotAvatar seed="seed_run" size={40} status="queued" />);
    await waitFor(() => expect(animState(container)).toBe("off"));

    rerender(<BotAvatar seed="seed_run" size={40} status="waiting_user" />);
    await waitFor(() => expect(animState(container)).toBe("off"));
  });

  it("inlines the same avatar markup regardless of status", async () => {
    stubMarkup(SAFE_MARKUP);
    const { rerender } = render(<BotAvatar seed="seed_same" size={40} status="idle" />, {
      container
    });
    await waitFor(() => expect(animState(container)).toBe("off"));
    const idle = container.querySelector("svg")?.outerHTML;

    rerender(<BotAvatar seed="seed_same" size={40} status="running" />);
    await waitFor(() => expect(animState(container)).toBe("on"));
    const running = container.querySelector("svg")?.outerHTML;

    expect(idle).toBe(running);
  });

  it("falls back to the image when the markup is rejected as unsafe", async () => {
    stubMarkup('<svg><script>alert(1)</script></svg>');
    render(<BotAvatar seed="seed_unsafe" size={40} status="running" />, { container });

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(animState(container)).toBeNull();
  });

  it("falls back to the image when the request fails", async () => {
    stubMarkup("", false);
    render(<BotAvatar seed="seed_missing" size={40} status="running" />, { container });

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(animState(container)).toBeNull();
  });
});
