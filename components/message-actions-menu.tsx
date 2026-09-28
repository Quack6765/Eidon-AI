"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GitFork, LoaderCircle, MoreHorizontal, Undo2, X } from "lucide-react";

import { MessageAction } from "@/components/ai-elements/message";
import { DropdownPortal } from "@/components/conversation-item";

const MENU_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/40 transition-colors duration-200 hover:bg-white/[0.04] hover:text-white focus-visible:bg-white/[0.04] focus-visible:text-white focus-visible:outline-none";

export function MessageActionsMenu({
  messageId,
  align,
  onFork,
  onRewind,
  isForking = false
}: {
  messageId: string;
  align: "start" | "end";
  onFork?: (messageId: string) => void;
  onRewind?: (messageId: string) => void;
  isForking?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirstItemRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const attachMenu = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node;
    if (node && focusFirstItemRef.current) {
      node.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus({ preventScroll: true });
    }
  }, []);

  if (!onFork && !onRewind) {
    return null;
  }

  function choose(handler: (messageId: string) => void) {
    setOpen(false);
    handler(messageId);
  }

  function openMenu(focusFirstItem: boolean) {
    focusFirstItemRef.current = focusFirstItem;
    setOpen(true);
  }

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!MENU_NAVIGATION_KEYS.has(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']")];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next].focus();
  }

  return (
    <>
      <MessageAction
        ref={triggerRef}
        label="More message actions"
        tooltip="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => (open ? setOpen(false) : openMenu(event.detail === 0))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
          event.preventDefault();
          openMenu(true);
        }}
        disabled={isForking}
      >
        {isForking ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MoreHorizontal className="h-3.5 w-3.5" />
        )}
      </MessageAction>
      <DropdownPortal anchorRef={triggerRef} open={open} side="top" align={align}>
        <div
          ref={attachMenu}
          role="menu"
          aria-label="Message actions"
          onKeyDown={moveFocus}
          className="relative w-full animate-fade-in rounded-2xl border border-white/5 bg-[#121214] p-2 shadow-2xl backdrop-blur-xl"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute right-1.5 top-1.5 p-1 text-white/20 transition-colors hover:text-white/60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {onFork ? (
            <button type="button" role="menuitem" className={MENU_ITEM_CLASS} onClick={() => choose(onFork)}>
              <GitFork className="h-4 w-4 opacity-50" />
              Fork from here
            </button>
          ) : null}
          {onRewind ? (
            <button type="button" role="menuitem" className={MENU_ITEM_CLASS} onClick={() => choose(onRewind)}>
              <Undo2 className="h-4 w-4 opacity-50" />
              Rewind to here
            </button>
          ) : null}
        </div>
      </DropdownPortal>
    </>
  );
}
