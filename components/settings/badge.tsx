export type BadgeVariant = "default" | "no-key" | "builtin" | "http" | "stdio";

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-emerald-500/10 text-emerald-400",
  "no-key": "bg-amber-500/10 text-amber-400",
  builtin: "bg-amber-500/10 text-amber-400",
  http: "bg-sky-500/10 text-sky-400",
  stdio: "bg-emerald-500/10 text-emerald-400",
};

export function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${variantStyles[variant]}`}
    >
      {children}
    </span>
  );
}
