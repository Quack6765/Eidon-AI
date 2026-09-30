export type BadgeVariant =
  | "default"
  | "no-key"
  | "builtin"
  | "http"
  | "stdio"
  | "violet"
  | "auth-required"
  | "stale"
  | "archived"
  | "pinned"
  | "managed"
  | "unused";

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-emerald-500/10 text-emerald-400",
  "no-key": "bg-amber-500/10 text-amber-400",
  builtin: "bg-amber-500/10 text-amber-400",
  http: "bg-sky-500/10 text-sky-400",
  stdio: "bg-emerald-500/10 text-emerald-400",
  violet: "bg-violet-500/10 text-violet-400",
  "auth-required": "bg-amber-500/10 text-amber-400",
  stale: "bg-amber-500/10 text-amber-400",
  archived: "bg-white/[0.06] text-[#a1a1aa]",
  pinned: "bg-violet-500/10 text-violet-400",
  managed: "bg-sky-500/10 text-sky-400",
  unused: "bg-white/[0.06] text-[#a1a1aa]"
};

export function Badge({
  variant,
  children
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${variantStyles[variant]}`}
    >
      {children}
    </span>
  );
}
