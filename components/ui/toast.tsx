"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, X, AlertTriangle } from "lucide-react";

type ToastVariant = "success" | "error" | "warning" | "info";

type ToastProps = {
  visible: boolean;
  variant: ToastVariant;
  message: string;
  onDismiss?: () => void;
};

const VARIANT_STYLES: Record<
  ToastVariant,
  { bg: string; border: string; text: string; icon: React.ElementType }
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
};

export function Toast({ visible, variant, message, onDismiss }: ToastProps) {
  const style = VARIANT_STYLES[variant];
  const IconComponent = style.icon;

  return (
    <AnimatePresence onExitComplete={onDismiss}>
      {visible && (
        <motion.div
          key="toast"
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
          }}
          exit={{ opacity: 0, transition: { duration: 0.8, ease: "easeOut" } }}
          className={`fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex items-center gap-2 rounded-lg border ${style.border} ${style.bg} px-4 py-2.5 text-sm ${style.text} shadow-[0_4px_24px_rgba(0,0,0,0.5)]`}
        >
          <IconComponent className="h-3.5 w-3.5" />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type { ToastProps, ToastVariant };
