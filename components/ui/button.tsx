import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.97]",
          variant === "primary" &&
            "bg-[var(--accent)] text-white hover:brightness-110 shadow-[0_0_16px_var(--accent-glow)]",
          variant === "secondary" &&
            "border border-white/8 bg-white/5 text-[var(--text)] hover:bg-white/10",
          variant === "ghost" &&
            "text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5",
          variant === "danger" &&
            "border border-red-400/20 bg-red-500/8 text-red-200 hover:bg-red-500/15",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
