// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openMermaidFullscreenFromCard } from "@/lib/mermaid-fullscreen";

describe("openMermaidFullscreenFromCard", () => {
  let fullscreenClicks: number;
  let downloadClicks: number;

  function renderBlock({ withActions = true } = {}) {
    document.body.innerHTML = `
      <div data-streamdown="mermaid-block">
        <div>mermaid</div>
        ${withActions ? `<div>
          <div data-streamdown="mermaid-block-actions">
            <div class="relative">
              <button data-testid="download" title="Download diagram"></button>
            </div>
            <button data-testid="copy" title="Copy Code"></button>
            <button data-testid="fullscreen" title="View fullscreen"></button>
          </div>
        </div>` : ""}
        <div data-testid="card"><svg><rect></rect></svg></div>
      </div>
      <button data-testid="outside"></button>
    `;
    const fullscreen = document.querySelector<HTMLButtonElement>(
      '[data-testid="fullscreen"]'
    );
    fullscreen?.addEventListener("click", () => {
      fullscreenClicks += 1;
    });
    const download = document.querySelector<HTMLButtonElement>(
      '[data-testid="download"]'
    );
    download?.addEventListener("click", () => {
      downloadClicks += 1;
    });
    return {
      card: document.querySelector<HTMLElement>('[data-testid="card"]')!,
      svgShape: document.querySelector<SVGElement>("svg rect")!
    };
  }

  beforeEach(() => {
    fullscreenClicks = 0;
    downloadClicks = 0;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the fullscreen view when the diagram card is clicked", () => {
    const { svgShape } = renderBlock();
    const handled = openMermaidFullscreenFromCard({ target: svgShape, detail: 1 });
    expect(handled).toBe(true);
    expect(fullscreenClicks).toBe(1);
    expect(downloadClicks).toBe(0);
  });

  it("ignores clicks outside the diagram card", () => {
    renderBlock();
    const outside = document.querySelector<HTMLElement>('[data-testid="outside"]')!;
    const handled = openMermaidFullscreenFromCard({ target: outside, detail: 1 });
    expect(handled).toBe(false);
    expect(fullscreenClicks).toBe(0);
  });

  it("leaves clicks on the block actions to their own buttons", () => {
    renderBlock();
    const copy = document.querySelector<HTMLElement>('[data-testid="copy"]')!;
    const handled = openMermaidFullscreenFromCard({ target: copy, detail: 1 });
    expect(handled).toBe(false);
    expect(fullscreenClicks).toBe(0);
  });

  it("ignores double clicks so the overlay does not immediately toggle", () => {
    const { svgShape } = renderBlock();
    const handled = openMermaidFullscreenFromCard({ target: svgShape, detail: 2 });
    expect(handled).toBe(false);
    expect(fullscreenClicks).toBe(0);
  });

  it("does nothing when the block has no actions", () => {
    const { svgShape } = renderBlock({ withActions: false });
    const handled = openMermaidFullscreenFromCard({ target: svgShape, detail: 1 });
    expect(handled).toBe(false);
    expect(fullscreenClicks).toBe(0);
  });

  it("ignores clicks with a non-element target", () => {
    const handled = openMermaidFullscreenFromCard({ target: null, detail: 1 });
    expect(handled).toBe(false);
  });

  it("stops propagation when it handles the click", () => {
    const { svgShape } = renderBlock();
    const stopPropagation = vi.fn();
    openMermaidFullscreenFromCard({ target: svgShape, detail: 1, stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});
