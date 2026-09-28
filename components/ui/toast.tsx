"use client";

import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, X, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "warning" | "info" | "neutral";

type ToastProps = {
  visible: boolean;
  variant: ToastVariant;
  message: string;
  onDismiss?: () => void;
  action?: { label: string; onClick: () => void };
  onClose?: () => void;
  onHoldChange?: (held: boolean) => void;
  inline?: boolean;
  className?: string;
};

const VARIANT_STYLES: Record<
  ToastVariant,
  { bg: string; border: string; text: string; icon: React.ElementType | null }
> = {
  success: {
    bg: "bg-emerald-900",
    border: "border-emerald-400/20",
    text: "text-emerald-200",
    icon: Check,
  },
  error: {
    bg: "bg-red-900",
    border: "border-red-400/20",
    text: "text-red-200",
    icon: X,
  },
  warning: {
    bg: "bg-amber-900",
    border: "border-amber-400/20",
    text: "text-amber-200",
    icon: AlertTriangle,
  },
  info: {
    bg: "bg-blue-900",
    border: "border-blue-400/20",
    text: "text-blue-200",
    icon: Info,
  },
  neutral: {
    bg: "bg-[var(--panel-strong)]",
    border: "border-white/10",
    text: "text-white/85",
    icon: null,
  },
};

export function Toast({
  visible,
  variant,
  message,
  onDismiss,
  action,
  onClose,
  onHoldChange,
  inline = false,
  className
}: ToastProps) {
  const style = VARIANT_STYLES[variant];
  const IconComponent = style.icon;

  if (typeof document === "undefined") return null;
  const toast = (
    <AnimatePresence onExitComplete={onDismiss}>
      {visible ? (
        <motion.div
          key="toast"
          role={variant === "error" ? "alert" : "status"}
          aria-live={variant === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
          }}
          exit={{ opacity: 0, transition: { duration: action || onClose ? 0.15 : 0.8, ease: "easeOut" } }}
          onPointerEnter={onHoldChange ? () => onHoldChange(true) : undefined}
          onPointerLeave={onHoldChange ? () => onHoldChange(false) : undefined}
          onFocus={onHoldChange ? () => onHoldChange(true) : undefined}
          onBlur={onHoldChange ? () => onHoldChange(false) : undefined}
          className={cn(
            inline ? "absolute z-[55]" : "fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[100]",
            `flex items-center gap-2 rounded-lg border ${style.border} ${style.bg} px-4 py-2.5 text-sm ${style.text} shadow-[0_4px_24px_rgba(0,0,0,0.5)]`,
            action || onClose ? "gap-3 py-2 pr-2" : null,
            className
          )}
        >
          {IconComponent ? <IconComponent className="h-3.5 w-3.5" /> : null}
          {action || onClose ? <span className="whitespace-nowrap">{message}</span> : message}
          {action || onClose ? (
            <span className="-my-1 flex items-center gap-0.5">
              {action ? (
                <button
                  type="button"
                  onClick={action.onClick}
                  className="rounded-md px-2 py-1 font-semibold text-violet-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  {action.label}
                </button>
              ) : null}
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Dismiss"
                  className="rounded-md p-1.5 text-white/40 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </span>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return inline ? toast : createPortal(toast, document.body);
}

export type { ToastProps, ToastVariant };
