// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { installPointerCaptureGuard } from "@/lib/pointer-capture-guard";

describe("installPointerCaptureGuard", () => {
  const originalSet = Element.prototype.setPointerCapture;
  const originalRelease = Element.prototype.releasePointerCapture;
  let behavior: () => void = () => {};
  let underlyingCalls = 0;

  beforeAll(() => {
    Element.prototype.setPointerCapture = function (this: Element, pointerId: number) {
      underlyingCalls += 1;
      behavior();
    };
    Element.prototype.releasePointerCapture = function (this: Element, pointerId: number) {
      underlyingCalls += 1;
      behavior();
    };
    installPointerCaptureGuard();
    installPointerCaptureGuard();
  });

  beforeEach(() => {
    behavior = () => {};
    underlyingCalls = 0;
  });

  afterAll(() => {
    Element.prototype.setPointerCapture = originalSet;
    Element.prototype.releasePointerCapture = originalRelease;
  });

  it("swallows NotFoundError from the pointer capture APIs", () => {
    behavior = () => {
      throw new DOMException("not active", "NotFoundError");
    };
    const el = document.createElement("div");
    expect(() => el.setPointerCapture(7)).not.toThrow();
    expect(() => el.releasePointerCapture(7)).not.toThrow();
  });

  it("rethrows unexpected errors", () => {
    behavior = () => {
      throw new TypeError("boom");
    };
    const el = document.createElement("div");
    expect(() => el.setPointerCapture(7)).toThrow(TypeError);
  });

  it("does not wrap the underlying implementation twice", () => {
    const el = document.createElement("div");
    el.setPointerCapture(7);
    el.releasePointerCapture(7);
    expect(underlyingCalls).toBe(2);
  });
});
