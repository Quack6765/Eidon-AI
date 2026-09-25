// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  computePinchScale,
  computeReanchor,
  installDiagramZoomAnchor
} from "@/lib/diagram-zoom-anchor";

type Vec = { x: number; y: number };

function map(
  point: Vec,
  state: {
    translate: Vec;
    scale: number;
    origin: Vec;
    offset: Vec;
    untransformedTopLeft: Vec;
  }
): Vec {
  return {
    x:
      state.untransformedTopLeft.x +
      state.offset.x +
      state.origin.x +
      state.translate.x +
      state.scale * (point.x - state.origin.x),
    y:
      state.untransformedTopLeft.y +
      state.offset.y +
      state.origin.y +
      state.translate.y +
      state.scale * (point.y - state.origin.y)
  };
}

describe("computeReanchor", () => {
  const box = { width: 1000, height: 800 };
  const boxCenter = { x: box.width / 2, y: box.height / 2 };
  const scenario = {
    translate: { x: 120, y: -40 },
    scale: 2,
    origin: { x: 500, y: 400 },
    offset: { x: 0, y: 0 },
    untransformedTopLeft: { x: 0, y: 0 }
  };
  const rectCenter = map(boxCenter, scenario);
  const viewCenter = { x: 640, y: 300 };

  const reanchored = computeReanchor({
    boxWidth: box.width,
    boxHeight: box.height,
    scale: scenario.scale,
    rectCenterX: rectCenter.x,
    rectCenterY: rectCenter.y,
    originX: scenario.origin.x,
    originY: scenario.origin.y,
    offsetX: scenario.offset.x,
    offsetY: scenario.offset.y,
    viewCenterX: viewCenter.x,
    viewCenterY: viewCenter.y
  });

  it("is render-invariant: re-anchoring moves no pixels", () => {
    const after = {
      ...scenario,
      origin: { x: reanchored.originX, y: reanchored.originY },
      offset: { x: reanchored.offsetX, y: reanchored.offsetY }
    };
    for (const point of [
      { x: 0, y: 0 },
      { x: 250, y: 700 },
      { x: 1000, y: 800 },
      { x: 130, y: 220 }
    ]) {
      const before = map(point, scenario);
      const now = map(point, after);
      expect(now.x).toBeCloseTo(before.x, 6);
      expect(now.y).toBeCloseTo(before.y, 6);
    }
  });

  it("holds the looked-at point fixed when the scale changes", () => {
    const anchorPoint = {
      x: reanchored.originX,
      y: reanchored.originY
    };
    const atCurrentScale = map(anchorPoint, {
      ...scenario,
      origin: { x: reanchored.originX, y: reanchored.originY },
      offset: { x: reanchored.offsetX, y: reanchored.offsetY }
    });
    const atNewScale = map(anchorPoint, {
      ...scenario,
      scale: scenario.scale * 1.4,
      origin: { x: reanchored.originX, y: reanchored.originY },
      offset: { x: reanchored.offsetX, y: reanchored.offsetY }
    });
    expect(atNewScale.x).toBeCloseTo(atCurrentScale.x, 6);
    expect(atNewScale.y).toBeCloseTo(atCurrentScale.y, 6);
  });

  it("places the anchor at the point currently in the middle of the view", () => {
    const anchorPoint = { x: reanchored.originX, y: reanchored.originY };
    const screen = map(anchorPoint, scenario);
    expect(screen.x).toBeCloseTo(viewCenter.x, 6);
    expect(screen.y).toBeCloseTo(viewCenter.y, 6);
  });

  it("keeps identity state unchanged when the view center matches", () => {
    const identity = computeReanchor({
      boxWidth: box.width,
      boxHeight: box.height,
      scale: 1,
      rectCenterX: boxCenter.x,
      rectCenterY: boxCenter.y,
      originX: boxCenter.x,
      originY: boxCenter.y,
      offsetX: 0,
      offsetY: 0,
      viewCenterX: boxCenter.x,
      viewCenterY: boxCenter.y
    });
    expect(identity.originX).toBeCloseTo(boxCenter.x, 6);
    expect(identity.originY).toBeCloseTo(boxCenter.y, 6);
    expect(identity.offsetX).toBeCloseTo(0, 6);
    expect(identity.offsetY).toBeCloseTo(0, 6);
  });
});

describe("computePinchScale", () => {
  it("scales proportionally to the finger distance ratio", () => {
    expect(
      computePinchScale({
        startScale: 1,
        startDistance: 100,
        distance: 200,
        innerScale: 1,
        minTotal: 0.5,
        maxTotal: 4
      })
    ).toBeCloseTo(2, 6);
  });

  it("clamps the total zoom against the inner scale", () => {
    expect(
      computePinchScale({
        startScale: 1,
        startDistance: 100,
        distance: 10000,
        innerScale: 2,
        minTotal: 0.5,
        maxTotal: 4
      })
    ).toBeCloseTo(2, 6);
    expect(
      computePinchScale({
        startScale: 1,
        startDistance: 100,
        distance: 1,
        innerScale: 4,
        minTotal: 0.5,
        maxTotal: 4
      })
    ).toBeCloseTo(0.125, 6);
  });

  it("returns the start scale for degenerate distances", () => {
    expect(
      computePinchScale({
        startScale: 1.5,
        startDistance: 0,
        distance: 100,
        innerScale: 1,
        minTotal: 0.5,
        maxTotal: 4
      })
    ).toBe(1.5);
  });
});

describe("diagram gesture controller", () => {
  beforeAll(() => {
    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      writable: true,
      value: class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;

        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
          this.pointerType = init.pointerType ?? "";
        }
      }
    });
    installDiagramZoomAnchor();
  });

  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="fixed inset-0 z-50">
        <div data-streamdown="mermaid">
          <div data-testid="root">
            <div role="application" style="transform: translate(0px, 0px) scale(1)">
              <svg viewBox="0 0 100 100"></svg>
            </div>
          </div>
        </div>
        <button data-testid="control">Zoom in</button>
      </div>
    `;
    root = document.querySelector<HTMLElement>('[data-testid="root"]')!;
  });

  afterEach(() => {
    const overlay = document.querySelector("div.fixed");
    if (overlay) overlay.remove();
  });

  function pointer(type: string, id: number, x: number, y: number, target: Element) {
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        bubbles: true
      })
    );
  }

  it("pans with a single pointer over the diagram", () => {
    pointer("pointerdown", 1, 100, 100, root);
    pointer("pointermove", 1, 150, 120, root);
    expect(root.style.getPropertyValue("--diagram-zoom-x")).toBe("50px");
    expect(root.style.getPropertyValue("--diagram-zoom-y")).toBe("20px");
    pointer("pointerup", 1, 150, 120, root);
  });

  it("ignores gestures that start on a control button", () => {
    const button = document.querySelector<HTMLElement>('[data-testid="control"]')!;
    const beforeX = root.style.getPropertyValue("--diagram-zoom-x");
    pointer("pointerdown", 7, 100, 100, button);
    pointer("pointermove", 7, 260, 40, button);
    expect(root.style.getPropertyValue("--diagram-zoom-x")).toBe(beforeX);
    pointer("pointerup", 7, 260, 40, button);
  });

  it("zooms with two pointers based on the distance ratio", () => {
    pointer("pointerdown", 11, 100, 100, root);
    pointer("pointerdown", 12, 200, 100, root);
    pointer("pointermove", 12, 300, 100, root);
    expect(Number(root.style.getPropertyValue("--diagram-zoom-g"))).toBeCloseTo(2, 3);
    pointer("pointerup", 12, 300, 100, root);
    pointer("pointerup", 11, 100, 100, root);
  });

  it("stops adjusting after all pointers are released", () => {
    pointer("pointerdown", 21, 100, 100, root);
    pointer("pointermove", 21, 140, 100, root);
    pointer("pointerup", 21, 140, 100, root);
    const frozen = root.style.getPropertyValue("--diagram-zoom-x");
    pointer("pointermove", 21, 400, 400, root);
    expect(root.style.getPropertyValue("--diagram-zoom-x")).toBe(frozen);
  });

  it("re-anchors the zoom origin before a control click applies its zoom step", () => {
    const layer = document.querySelector<HTMLElement>('[role="application"]')!;
    layer.style.removeProperty("--diagram-zoom-origin");
    const button = document.querySelector<HTMLElement>('[data-testid="control"]')!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(layer.style.getPropertyValue("--diagram-zoom-origin")).not.toBe("");
  });
});
