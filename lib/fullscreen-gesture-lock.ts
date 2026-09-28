const FULLSCREEN_OVERLAY_SELECTOR = "body > div.fixed.inset-0.z-50";
const MERMAID_CARD_SELECTOR = '[data-streamdown="mermaid-block"]';

const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

let installed = false;

export function installFullscreenGestureLock(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const blockInsideLockedSurface = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest(FULLSCREEN_OVERLAY_SELECTOR) ||
        target.closest(MERMAID_CARD_SELECTOR))
    ) {
      event.preventDefault();
    }
  };
  for (const type of GESTURE_EVENTS) {
    document.addEventListener(type, blockInsideLockedSurface, { passive: false });
  }
}
