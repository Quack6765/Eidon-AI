let installed = false;

export function installPointerCaptureGuard(): void {
  if (installed || typeof Element === "undefined") return;
  installed = true;
  for (const method of ["setPointerCapture", "releasePointerCapture"] as const) {
    const original = Element.prototype[method];
    if (typeof original !== "function") continue;
    Element.prototype[method] = function guardedPointerCapture(
      this: Element,
      pointerId: number
    ): void {
      try {
        original.call(this, pointerId);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) {
          throw error;
        }
      }
    };
  }
}
