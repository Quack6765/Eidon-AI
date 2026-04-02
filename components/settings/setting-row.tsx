export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--text)]">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs text-[var(--muted)]">{description}</div>
        ) : null}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
