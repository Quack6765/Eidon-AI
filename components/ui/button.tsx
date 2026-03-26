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
          "inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50",
          variant === "primary" &&
            "border-[color:var(--accent)] bg-[color:var(--accent)] text-[#171209] hover:brightness-110",
          variant === "secondary" &&
            "border-[color:var(--line-strong)] bg-white/5 text-[color:var(--text)] hover:bg-white/10",
          variant === "ghost" &&
            "border-transparent bg-transparent text-[color:var(--muted)] hover:text-[color:var(--text)]",
          variant === "danger" &&
            "border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
