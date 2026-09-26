"use client";

import { Keyboard, LoaderCircle, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { displayComputerUrl, requestComputerControl, useComputerStream } from "@/hooks/use-computer-stream";

const POINTER_MOVE_INTERVAL_MS = 50;

function modifierBits(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

function pointerButton(button: number): "left" | "middle" | "right" {
  return button === 1 ? "middle" : button === 2 ? "right" : "left";
}

export function ComputerStage({
  conversationId,
  askForNote = false,
  onClose
}: {
  conversationId: string;
  askForNote?: boolean;
  onClose: () => void;
}) {
  const { view, send } = useComputerStream(conversationId);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef<HTMLTextAreaElement | null>(null);
  const lastMoveRef = useRef(0);
  const hadControlRef = useRef(false);
  const [note, setNote] = useState("");
  const [isReturning, setIsReturning] = useState(false);
  const [error, setError] = useState("");
  const width = view.viewport?.width ?? 16;
  const height = view.viewport?.height ?? 9;
  const url = displayComputerUrl(view.url);

  useEffect(() => {
    stageRef.current?.focus();
  }, []);

  useEffect(() => {
    if (view.controlOwner === "user") hadControlRef.current = true;
    else if (hadControlRef.current) onClose();
  }, [view.controlOwner, onClose]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      send({
        type: "computer_wheel",
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
        deltaX: event.deltaX,
        deltaY: event.deltaY
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [send]);

  function pointer(event: ReactPointerEvent<HTMLDivElement>, action: "down" | "up" | "move") {
    const rect = event.currentTarget.getBoundingClientRect();
    if (action === "move") {
      const now = Date.now();
      if (now - lastMoveRef.current < POINTER_MOVE_INTERVAL_MS) return;
      lastMoveRef.current = now;
    } else {
      event.preventDefault();
      stageRef.current?.focus();
    }
    send({
      type: "computer_pointer",
      action,
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      ...(action === "move" ? {} : { button: pointerButton(event.button), clickCount: Math.max(1, event.detail || 1) })
    });
  }

  function key(event: ReactKeyboardEvent<HTMLDivElement>, action: "down" | "up") {
    if (event.target !== stageRef.current) return;
    if (action === "down" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    send({ type: "computer_key", action, key: event.key, modifiers: modifierBits(event) });
  }

  async function handleReturn() {
    setIsReturning(true);
    setError("");
    try {
      await requestComputerControl(conversationId, "return", note.trim());
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not return control");
      setIsReturning(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="You're in control of the browser"
      data-testid="computer-stage"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-3 md:px-6">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/88">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
          You&apos;re in control
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-white/45">
          {url ? `${url} · the bot can't use the browser until you return control` : "The bot can't use the browser until you return control"}
        </span>
        {askForNote ? (
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder="Note for the bot (optional)"
            aria-label="Note for the bot"
            className="h-9 w-full rounded-md border border-white/8 bg-white/[0.03] px-3 text-[16px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none md:w-64 md:text-[12px]"
          />
        ) : null}
        <button
          type="button"
          onClick={() => void handleReturn()}
          disabled={isReturning}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isReturning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Return control
        </button>
        <button
          type="button"
          onClick={() => typingRef.current?.focus()}
          aria-label="Type into the page"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/60 transition hover:bg-white/[0.06] hover:text-white md:hidden"
        >
          <Keyboard className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Minimize the browser"
          title="Minimize — you keep control"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/60 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        </button>
        {error ? <p className="w-full text-[11px] text-red-300">{error}</p> : null}
      </div>

      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={(event) => key(event, "down")}
        onKeyUp={(event) => key(event, "up")}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if (!text) return;
          event.preventDefault();
          send({ type: "computer_text", text });
        }}
        className="flex min-h-0 flex-1 items-center justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))] focus:outline-none md:px-6"
        data-testid="computer-stage-keys"
      >
        <div
          ref={frameRef}
          onPointerDown={(event) => pointer(event, "down")}
          onPointerUp={(event) => pointer(event, "up")}
          onPointerMove={(event) => pointer(event, "move")}
          onContextMenu={(event) => event.preventDefault()}
          className="relative touch-none overflow-hidden rounded-md border border-white/10 bg-black/60"
          style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, 72rem, calc((100dvh - 7rem) * ${width} / ${height}))` }}
          data-testid="computer-stage-frame"
        >
          {view.frameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Frames are in-memory blob URLs from the live browser stream that next/image cannot load.
            <img src={view.frameUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/40">
              Waiting for the browser…
            </div>
          )}
        </div>
      </div>

      <textarea
        ref={typingRef}
        aria-label="Type into the page"
        className="pointer-events-none absolute h-px w-px opacity-0"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Backspace" || event.key === "Tab") {
            event.preventDefault();
            send({ type: "computer_key", action: "down", key: event.key });
            send({ type: "computer_key", action: "up", key: event.key });
          }
        }}
        onInput={(event) => {
          const text = event.currentTarget.value;
          event.currentTarget.value = "";
          if (text) send({ type: "computer_text", text });
        }}
      />
    </div>,
    document.body
  );
}
