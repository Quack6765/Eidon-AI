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
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--text)]">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs text-[var(--muted)]">{description}</div>
        ) : null}
      </div>
      <div className="w-full sm:w-auto sm:flex-shrink-0">{children}</div>
    </div>
  );
}
