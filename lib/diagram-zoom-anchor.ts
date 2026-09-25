const ZOOM_LAYER_SELECTOR = '[data-streamdown="mermaid"] [role="application"]';

const TRANSFORM_PATTERN =
  /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/;

const ORIGIN_PATTERN = /([-\d.]+)px\s+([-\d.]+)px/;

export function computeReanchor(input: {
  boxWidth: number;
  boxHeight: number;
  scale: number;
  rectCenterX: number;
  rectCenterY: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
  viewCenterX: number;
  viewCenterY: number;
}): { originX: number; originY: number; offsetX: number; offsetY: number } {
  const boxX = input.boxWidth / 2;
  const boxY = input.boxHeight / 2;
  const dx = input.viewCenterX - input.rectCenterX;
  const dy = input.viewCenterY - input.rectCenterY;
  return {
    originX: boxX + dx / input.scale,
    originY: boxY + dy / input.scale,
    offsetX:
      input.offsetX +
      (input.originX - boxX) * (1 - input.scale) +
      dx * (1 - 1 / input.scale),
    offsetY:
      input.offsetY +
      (input.originY - boxY) * (1 - input.scale) +
      dy * (1 - 1 / input.scale)
  };
}

function readNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

let lastPointer: { x: number; y: number } | null = null;

function rememberPointer(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('[data-streamdown="mermaid"]')) return;
  if (target.closest("button")) return;
  if (event instanceof MouseEvent) {
    lastPointer = { x: event.clientX, y: event.clientY };
    return;
  }
  if (event instanceof TouchEvent) {
    const touch = event.touches[0];
    if (touch) {
      lastPointer = { x: touch.clientX, y: touch.clientY };
    }
  }
}

export function computePinchScale(input: {
  startScale: number;
  startDistance: number;
  distance: number;
  innerScale: number;
  minTotal: number;
  maxTotal: number;
}): number {
  const { startScale, startDistance, distance, innerScale, minTotal, maxTotal } = input;
  if (startDistance <= 0 || distance <= 0 || innerScale <= 0) return startScale;
  const raw = startScale * (distance / startDistance);
  return Math.min(Math.max(raw, minTotal / innerScale), maxTotal / innerScale);
}

function parseInnerScale(layer: HTMLElement): number {
  const match = TRANSFORM_PATTERN.exec(layer.style.transform);
  const scale = match ? Number(match[3]) : 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function setVar(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) {
    element.style.setProperty(name, value);
  }
}

function updateLayer(layer: HTMLElement): void {
  if (typeof document === "undefined") return;
  const transform = TRANSFORM_PATTERN.exec(layer.style.transform);
  if (!transform) return;
  const translateX = Number(transform[1]);
  const translateY = Number(transform[2]);
  const scale = Number(transform[3]);
  if (
    !Number.isFinite(translateX) ||
    !Number.isFinite(translateY) ||
    !Number.isFinite(scale) ||
    scale === 0
  ) {
    return;
  }
  const outer = layer.parentElement;
  if (!outer) return;
  const rect = layer.getBoundingClientRect();
  const overlay = layer.closest("body > div.fixed.inset-0.z-50");
  const host = overlay instanceof HTMLElement ? overlay : document.documentElement;
  const hostRect = host.getBoundingClientRect();
  const boxWidth = layer.offsetWidth;
  const boxHeight = layer.offsetHeight;
  const originMatch = ORIGIN_PATTERN.exec(
    layer.style.getPropertyValue("--diagram-zoom-origin")
  );
  const pointer =
    lastPointer !== null &&
    lastPointer.x >= hostRect.left &&
    lastPointer.x <= hostRect.right &&
    lastPointer.y >= hostRect.top &&
    lastPointer.y <= hostRect.bottom
      ? lastPointer
      : null;
  const anchorPoint = pointer ?? {
    x: hostRect.left + hostRect.width / 2,
    y: hostRect.top + hostRect.height / 2
  };
  const anchor = computeReanchor({
    boxWidth,
    boxHeight,
    scale,
    rectCenterX: rect.left + rect.width / 2,
    rectCenterY: rect.top + rect.height / 2,
    originX: originMatch ? Number(originMatch[1]) : boxWidth / 2,
    originY: originMatch ? Number(originMatch[2]) : boxHeight / 2,
    offsetX: readNumber(outer.style.getPropertyValue("--diagram-zoom-x")) ?? 0,
    offsetY: readNumber(outer.style.getPropertyValue("--diagram-zoom-y")) ?? 0,
    viewCenterX: anchorPoint.x,
    viewCenterY: anchorPoint.y
  });
  setVar(layer, "--diagram-zoom-origin", `${anchor.originX}px ${anchor.originY}px`);
  setVar(outer, "--diagram-zoom-x", `${anchor.offsetX}px`);
  setVar(outer, "--diagram-zoom-y", `${anchor.offsetY}px`);
}

let installed = false;

const MIN_TOTAL_SCALE = 0.5;
const MAX_TOTAL_SCALE = 4;

const activePointers = new Map<number, { x: number; y: number }>();

const gesture = {
  mode: "idle" as "idle" | "pan" | "pinch",
  root: null as HTMLElement | null,
  svg: null as SVGSVGElement | null,
  pointerId: -1,
  panOrigin: { x: 0, y: 0 },
  offsetStart: { x: 0, y: 0 },
  pinchDistance: 0,
  pinchScale: 1,
  anchor: null as { x: number; y: number } | null
};

function readVar(element: HTMLElement, name: string): number {
  return readNumber(element.style.getPropertyValue(name)) ?? 0;
}

function midpointOf(pointers: { x: number; y: number }[]) {
  const a = pointers[0];
  const b = pointers[1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distanceOf(pointers: { x: number; y: number }[]) {
  const a = pointers[0];
  const b = pointers[1];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isGestureTarget(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (!target.closest("body > div.fixed.inset-0.z-50")) return false;
  return !target.closest("button");
}

function resolveGestureNodes(target: Element) {
  const overlay = target.closest("body > div.fixed.inset-0.z-50");
  const root = overlay?.querySelector<HTMLElement>('[data-streamdown="mermaid"] > div') ?? null;
  const svg =
    overlay?.querySelector<SVGSVGElement>(
      '[data-streamdown="mermaid"] svg[viewBox]:not([viewBox="0 0 16 16"])'
    ) ?? null;
  return { root, svg };
}

function handleGestureDown(event: PointerEvent): void {
  if (!isGestureTarget(event)) return;
  const target = event.target as Element;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const points = [...activePointers.values()];
  const { root, svg } = resolveGestureNodes(target);
  if (!root) {
    activePointers.delete(event.pointerId);
    return;
  }
  if (points.length === 1) {
    gesture.mode = "pan";
    gesture.root = root;
    gesture.svg = svg;
    gesture.pointerId = event.pointerId;
    gesture.panOrigin = { x: event.clientX, y: event.clientY };
    gesture.offsetStart = {
      x: readVar(root, "--diagram-zoom-x"),
      y: readVar(root, "--diagram-zoom-y")
    };
    return;
  }
  if (points.length === 2) {
    gesture.mode = "pinch";
    gesture.root = root;
    gesture.svg = svg;
    gesture.pinchDistance = distanceOf(points);
    gesture.pinchScale = readNumber(root.style.getPropertyValue("--diagram-zoom-g")) ?? 1;
    const midpoint = midpointOf(points);
    if (svg && typeof svg.getScreenCTM === "function") {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const local = new DOMPoint(midpoint.x, midpoint.y).matrixTransform(ctm.inverse());
        gesture.anchor = { x: local.x, y: local.y };
      } else {
        gesture.anchor = null;
      }
    } else {
      gesture.anchor = null;
    }
  }
}

function handleGestureMove(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const root = gesture.root;
  if (!root) return;
  if (gesture.mode === "pan" && gesture.pointerId === event.pointerId) {
    setVar(root, "--diagram-zoom-x", `${gesture.offsetStart.x + (event.clientX - gesture.panOrigin.x)}px`);
    setVar(root, "--diagram-zoom-y", `${gesture.offsetStart.y + (event.clientY - gesture.panOrigin.y)}px`);
    return;
  }
  if (gesture.mode === "pinch" && activePointers.size >= 2) {
    const points = [...activePointers.values()];
    const distance = distanceOf(points);
    const midpoint = midpointOf(points);
    const layer = root.querySelector<HTMLElement>('[role="application"]');
    const innerScale = layer ? parseInnerScale(layer) : 1;
    const nextScale = computePinchScale({
      startScale: gesture.pinchScale,
      startDistance: gesture.pinchDistance,
      distance,
      innerScale,
      minTotal: MIN_TOTAL_SCALE,
      maxTotal: MAX_TOTAL_SCALE
    });
    setVar(root, "--diagram-zoom-g", `${nextScale}`);
    const svg = gesture.svg;
    const anchor = gesture.anchor;
    if (svg && anchor && typeof svg.getScreenCTM === "function") {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const now = new DOMPoint(anchor.x, anchor.y).matrixTransform(ctm);
        setVar(root, "--diagram-zoom-x", `${readVar(root, "--diagram-zoom-x") + (midpoint.x - now.x)}px`);
        setVar(root, "--diagram-zoom-y", `${readVar(root, "--diagram-zoom-y") + (midpoint.y - now.y)}px`);
      }
    }
  }
}

function handleGestureUp(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.delete(event.pointerId);
  const root = gesture.root;
  if (!root) return;
  const points = [...activePointers.values()];
  if (points.length === 0) {
    gesture.mode = "idle";
    gesture.root = null;
    gesture.svg = null;
    gesture.pointerId = -1;
    gesture.anchor = null;
    return;
  }
  const surrogate = points[0];
  gesture.mode = "pan";
  gesture.pointerId = [...activePointers.keys()][0];
  gesture.panOrigin = { x: surrogate.x, y: surrogate.y };
  gesture.offsetStart = {
    x: readVar(root, "--diagram-zoom-x"),
    y: readVar(root, "--diagram-zoom-y")
  };
}

export function installDiagramZoomAnchor(): void {
  if (installed || typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return;
  }
  installed = true;
  const updateAll = () => {
    if (typeof document === "undefined") return;
    for (const layer of document.querySelectorAll<HTMLElement>(ZOOM_LAYER_SELECTOR)) {
      updateLayer(layer);
    }
  };
  const observer = new MutationObserver((mutations) => {
    if (typeof document === "undefined") return;
    for (const mutation of mutations) {
      const target = mutation.target;
      if (
        mutation.type === "attributes" &&
        target instanceof HTMLElement &&
        target.matches(ZOOM_LAYER_SELECTOR)
      ) {
        updateLayer(target);
      } else if (mutation.type === "childList") {
        updateAll();
      }
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["style"],
    childList: true,
    subtree: true
  });
  document.addEventListener("pointerdown", rememberPointer, true);
  document.addEventListener("pointermove", rememberPointer, true);
  document.addEventListener("wheel", rememberPointer, true);
  document.addEventListener("touchstart", rememberPointer, true);
  const preemptZoom = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest("body > div.fixed.inset-0.z-50")) return;
    for (const layer of document.querySelectorAll<HTMLElement>(ZOOM_LAYER_SELECTOR)) {
      updateLayer(layer);
    }
  };
  document.addEventListener("click", preemptZoom, true);
  document.addEventListener("wheel", preemptZoom, true);
  document.addEventListener("pointerdown", handleGestureDown, true);
  document.addEventListener("pointermove", handleGestureMove, true);
  document.addEventListener("pointerup", handleGestureUp, true);
  document.addEventListener("pointercancel", handleGestureUp, true);
  window.addEventListener("resize", updateAll);
  updateAll();
}
