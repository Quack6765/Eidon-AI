"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type TextEditModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  title: string;
  subtitle?: string;
  placeholder?: string;
  readOnly?: boolean;
};

export function TextEditModal({
  open,
  onOpenChange,
  value,
  onChange,
  title,
  subtitle,
  placeholder,
  readOnly,
}: TextEditModalProps) {
  const titleId = useId();
  const [draft, setDraft] = useState(value);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = setTimeout(() => setToastVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [toastVisible]);

  function handleClose() {
    onOpenChange(false);
  }

  function handleSave() {
    onChange(draft);
    onOpenChange(false);
    setToastVisible(true);
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />
          <div className="relative w-full max-w-[720px] max-h-[80vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 id={titleId} className="text-sm font-semibold text-[var(--text)]">{title}</h3>
              <button
                type="button"
                onClick={handleClose}
                className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            {subtitle ? (
              <p className="mb-3 text-xs text-[var(--muted)]">{subtitle}</p>
            ) : null}
            <Textarea
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={16}
              placeholder={placeholder}
              readOnly={readOnly}
              className={cn("flex-1 resize-none min-h-[300px]", readOnly && "opacity-60 cursor-default")}
            />
            <div className="flex flex-wrap items-center justify-end gap-2 mt-5 pt-4 border-t border-white/[0.06]">
              <Button
                type="button"
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="px-3 py-1.5 text-xs"
                onClick={handleSave}
                disabled={readOnly}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            key="save-toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.8, ease: "easeOut" } }}
            className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 left-4 sm:left-auto z-50 flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-900 px-4 py-2.5 text-sm text-emerald-200 shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
          >
            <Check className="h-3.5 w-3.5" />
            Saved successfully !
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
