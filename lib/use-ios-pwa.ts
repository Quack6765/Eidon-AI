"use client";

import { useEffect } from "react";

import { isScrolledToBottom } from "@/lib/utils";

const IOS_PWA_CLASS = "ios-pwa";
const FOCUS_SETTLE_DELAY_MS = 300;
export const IOS_PWA_CONVERSATION_VIEWPORT_EVENT =
  "eidon:ios-pwa-conversation-viewport-preserved";

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
    let focusedConversationViewport: {
      element: HTMLElement;
      clientHeight: number;
    } | null = null;

    const captureConversationViewport = () => {
      const element = document.querySelector<HTMLElement>(".conversation-scroller");
      if (!element || !isScrolledToBottom(element)) {
        focusedConversationViewport = null;
        return;
      }

      focusedConversationViewport = { element, clientHeight: element.clientHeight };
    };

    const preserveConversationViewport = () => {
      if (!focusedConversationViewport) {
        return;
      }

      const { element, clientHeight } = focusedConversationViewport;
      if (!element.isConnected) {
        focusedConversationViewport = null;
        return;
      }

      focusedConversationViewport.clientHeight = element.clientHeight;
      const viewportHeightLoss = clientHeight - element.clientHeight;
      if (viewportHeightLoss <= 0) {
        return;
      }
      const maximumScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = Math.min(element.scrollTop + viewportHeightLoss, maximumScrollTop);
    };

    const lockConversationViewport = () => {
      const element = document.querySelector<HTMLElement>(".conversation-scroller");
      if (!element) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent<number>(IOS_PWA_CONVERSATION_VIEWPORT_EVENT, {
          detail: element.scrollTop,
        }),
      );
    };

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
      const vv = window.visualViewport;
      const scale = vv?.scale ?? 1;
      const height =
        vv && scale === 1
          ? Math.min(Math.round(window.innerHeight), Math.round(vv.height))
          : Math.round(window.innerHeight);
      if (height !== lastHeight) {
        const hasMeasuredHeight = lastHeight >= 0;
        lastHeight = height;
        root.style.setProperty("--ios-app-height", `${height}px`);
        preserveConversationViewport();
        if (hasMeasuredHeight) {
          lockConversationViewport();
        }
      }
      correctScroll();
    };

    const scheduleApply = () => {
      if (frameHandle !== null) {
        return;
      }
      frameHandle = window.requestAnimationFrame(applyHeight);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && isEditableElement(target)) {
        captureConversationViewport();
        return;
      }

      focusedConversationViewport = null;
    };

    const handleFocusIn = () => {
      if (!focusedConversationViewport) {
        captureConversationViewport();
      }
      scheduleApply();
      if (focusTimeout !== null) {
        window.clearTimeout(focusTimeout);
      }
      focusTimeout = window.setTimeout(() => {
        focusTimeout = null;
        applyHeight();
      }, FOCUS_SETTLE_DELAY_MS);
    };

    const handleFocusOut = () => {
      focusedConversationViewport = null;
    };

    applyHeight();
    window.addEventListener("resize", scheduleApply);
    window.addEventListener("orientationchange", scheduleApply);
    window.visualViewport?.addEventListener("resize", scheduleApply);
    window.visualViewport?.addEventListener("scroll", scheduleApply);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

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
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);
}
