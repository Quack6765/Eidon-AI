// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { buildLinkSafetyConfig } from "@/components/link-safety-modal";

describe("buildLinkSafetyConfig", () => {
  it("opens links directly without the modal when confirmation is turned off", () => {
    const config = buildLinkSafetyConfig(false);
    expect(config.enabled).toBe(true);
    expect(config.onLinkCheck).toBeInstanceOf(Function);
    expect(config.onLinkCheck!("https://example.com")).toBe(true);
  });

  it("enables link safety and renders a portaled modal when confirmation is on", () => {
    const config = buildLinkSafetyConfig(true);
    expect(config.enabled).toBe(true);

    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { unmount } = render(
      <>{config.renderModal!({ isOpen: true, url: "https://example.com", onClose, onConfirm })}</>
    );

    // The modal is portaled to document.body, escaping any transformed ancestor.
    const modal = document.body.querySelector('[data-streamdown="link-safety-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.querySelector("p")!.textContent).toContain("external website");
    expect(screen.getByText("https://example.com")).toBeTruthy();
    expect(screen.getByText("Open link")).toBeTruthy();

    unmount();
  });

  it("opens the link and closes the modal on confirm", () => {
    const config = buildLinkSafetyConfig(true);
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <>{config.renderModal!({ isOpen: true, url: "https://example.com", onClose, onConfirm })}</>
    );

    fireEvent.click(screen.getByText("Open link"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the modal is closed", () => {
    const config = buildLinkSafetyConfig(true);
    const { container } = render(
      <>{config.renderModal!({
        isOpen: false,
        url: "https://example.com",
        onClose: vi.fn(),
        onConfirm: vi.fn()
      })}</>
    );

    expect(container.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull();
    expect(document.body.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull();
  });
});
