export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
