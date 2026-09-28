import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { BotAvatar } from "@/components/agents/bot-avatar";
import type { ReferenceToken, ReferenceTrigger } from "@/lib/reference-tokens";
import { cn } from "@/lib/utils";

export type ReferenceOption = { name: string; detail?: string; avatarSeed?: string };

const TOKEN_TINT: Record<ReferenceTrigger, string> = {
  "@": "bg-violet-400/20",
  "/": "bg-indigo-400/20"
};

const TOKEN_SHAPE = "-mx-[2px] rounded-[4px] px-[2px] box-decoration-clone";

const MIRRORED_STYLE_PROPERTIES = [
  "box-sizing",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "tab-size",
  "text-indent",
  "text-transform",
  "word-spacing",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width"
];

export function ReferenceMenu({
  id,
  trigger,
  options,
  activeIndex,
  onActiveIndexChange,
  onSelect
}: {
  id: string;
  trigger: ReferenceTrigger;
  options: ReferenceOption[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (option: ReferenceOption) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const label = trigger === "@" ? "Hand off to a bot" : "Use a skill";

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.95 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: reduceMotion ? 0.1 : 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="absolute bottom-full left-2 z-50 mb-2 w-[min(22rem,calc(100%-1rem))] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-1.5 shadow-2xl"
    >
      <div className="px-3 pb-1 pt-1 text-[11px] font-semibold text-white/55">{label}</div>
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={label}
        className="max-h-[300px] overflow-y-auto scrollbar-thin"
      >
        {options.map((option, index) => (
          <div
            key={option.name}
            id={`${id}-option-${index}`}
            data-index={index}
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => onActiveIndexChange(index)}
            onClick={() => onSelect(option)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 transition-colors md:min-h-0",
              index === activeIndex ? "bg-white/10" : "hover:bg-white/5"
            )}
          >
            {option.avatarSeed ? (
              <BotAvatar seed={option.avatarSeed} size={24} />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-400/10 text-indigo-300">
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-white/85">
                {trigger}
                {option.name}
              </span>
              {option.detail ? (
                <span className="block truncate text-[11px] text-white/55">{option.detail}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function ReferenceHighlight({
  textareaRef,
  value,
  tokens
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  tokens: ReferenceToken[];
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!textarea || !mirror) return;

    const sync = () => {
      const style = window.getComputedStyle(textarea);
      for (const property of MIRRORED_STYLE_PROPERTIES) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      const scrollbarWidth =
        textarea.offsetWidth -
        textarea.clientWidth -
        (parseFloat(style.borderLeftWidth) || 0) -
        (parseFloat(style.borderRightWidth) || 0);
      mirror.style.paddingRight = `${(parseFloat(style.paddingRight) || 0) + Math.max(0, scrollbarWidth)}px`;
      mirror.style.top = `${textarea.offsetTop}px`;
      mirror.style.left = `${textarea.offsetLeft}px`;
      mirror.style.width = `${textarea.offsetWidth}px`;
      mirror.style.height = `${textarea.offsetHeight}px`;
      mirror.scrollTop = textarea.scrollTop;
    };

    sync();
    textarea.addEventListener("scroll", sync);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(textarea);
    return () => {
      textarea.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
  }, [textareaRef, value]);

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) segments.push(value.slice(cursor, token.start));
    segments.push(
      <span key={token.start} className={cn(TOKEN_SHAPE, TOKEN_TINT[token.trigger])}>
        {value.slice(token.start, token.end)}
      </span>
    );
    cursor = token.end;
  }
  segments.push(`${value.slice(cursor)}\u200b`);

  return (
    <div
      ref={mirrorRef}
      aria-hidden="true"
      data-testid="reference-highlight"
      className="pointer-events-none absolute overflow-hidden whitespace-pre-wrap break-words border-solid border-transparent text-transparent"
    >
      {segments}
    </div>
  );
}

export function ReferenceTokenMark({ kind, children }: { kind?: unknown; children?: React.ReactNode }) {
  return (
    <span
      data-reference-kind={kind === "bot" ? "bot" : "skill"}
      className={cn(TOKEN_SHAPE, "font-medium", TOKEN_TINT[kind === "bot" ? "@" : "/"])}
    >
      {children}
    </span>
  );
}
