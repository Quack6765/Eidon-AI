"use client";

import { useEffect } from "react";

const IOS_PWA_CLASS = "ios-pwa";
const FOCUS_SETTLE_DELAY_MS = 300;

function isIosStandalone(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (navigator as { standalone?: boolean }).standalone === true;
}

function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element.isContentEditable
  );
}

export function useIosPwa() {
  useEffect(() => {
    if (!isIosStandalone()) {
      return;
    }

    const root = document.documentElement;
    root.classList.add(IOS_PWA_CLASS);

    let frameHandle: number | null = null;
    let focusTimeout: number | null = null;
    let lastHeight = -1;

    const correctScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
      const scroller = document.scrollingElement;
      if (scroller) {
        if (scroller.scrollTop !== 0) {
          scroller.scrollTop = 0;
        }
        if (scroller.scrollLeft !== 0) {
          scroller.scrollLeft = 0;
        }
      }
      const active = document.activeElement;
      if (isEditableElement(active)) {
        active.scrollIntoView({ block: "nearest" });
      }
    };

    const applyHeight = () => {
      frameHandle = null;
      correctScroll();
      const vv = window.visualViewport;
      const scale = vv?.scale ?? 1;
      const height =
        vv && scale === 1
          ? Math.min(Math.round(window.innerHeight), Math.round(vv.height))
          : Math.round(window.innerHeight);
      if (height === lastHeight) {
        return;
      }
      lastHeight = height;
      root.style.setProperty("--ios-app-height", `${height}px`);
    };

    const scheduleApply = () => {
      if (frameHandle !== null) {
        return;
      }
      frameHandle = window.requestAnimationFrame(applyHeight);
    };

    const handleFocusIn = () => {
      scheduleApply();
      if (focusTimeout !== null) {
        window.clearTimeout(focusTimeout);
      }
      focusTimeout = window.setTimeout(() => {
        focusTimeout = null;
        correctScroll();
      }, FOCUS_SETTLE_DELAY_MS);
    };

    applyHeight();
    window.addEventListener("resize", scheduleApply);
    window.addEventListener("orientationchange", scheduleApply);
    window.visualViewport?.addEventListener("resize", scheduleApply);
    window.visualViewport?.addEventListener("scroll", scheduleApply);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }
      if (focusTimeout !== null) {
        window.clearTimeout(focusTimeout);
      }
      root.classList.remove(IOS_PWA_CLASS);
      root.style.removeProperty("--ios-app-height");
      window.removeEventListener("resize", scheduleApply);
      window.removeEventListener("orientationchange", scheduleApply);
      window.visualViewport?.removeEventListener("resize", scheduleApply);
      window.visualViewport?.removeEventListener("scroll", scheduleApply);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, []);
}
