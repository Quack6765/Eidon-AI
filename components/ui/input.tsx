import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        suppressHydrationWarning
        className={cn(
          "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 placeholder:text-[var(--muted)] focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
