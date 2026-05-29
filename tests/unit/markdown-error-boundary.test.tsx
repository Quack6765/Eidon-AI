// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { MarkdownErrorBoundary } from "@/components/markdown-error-boundary";

function Bomb({ throwError }: { throwError: boolean }) {
  if (throwError) throw new Error("kaboom");
  return <div>ok</div>;
}

describe("MarkdownErrorBoundary", () => {
  it("renders children when no error is thrown", () => {
    const { container } = render(
      <MarkdownErrorBoundary fallback={<div>fallback</div>} resetKey="a">
        <Bomb throwError={false} />
      </MarkdownErrorBoundary>
    );
    expect(container.textContent).toBe("ok");
  });

  it("renders the fallback when a child throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <MarkdownErrorBoundary fallback={<div data-testid="fb">fb-content</div>} resetKey="a">
        <Bomb throwError={true} />
      </MarkdownErrorBoundary>
    );
    expect(container.textContent).toBe("fb-content");
    errorSpy.mockRestore();
  });

  it("resets the error state when resetKey changes", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(
      <MarkdownErrorBoundary fallback={<div>fb</div>} resetKey="a">
        <Bomb throwError={true} />
      </MarkdownErrorBoundary>
    );
    expect(container.textContent).toBe("fb");

    rerender(
      <MarkdownErrorBoundary fallback={<div>fb</div>} resetKey="b">
        <Bomb throwError={false} />
      </MarkdownErrorBoundary>
    );
    expect(container.textContent).toBe("ok");
    errorSpy.mockRestore();
  });
});
