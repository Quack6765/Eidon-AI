export function FileDropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--panel)] px-6 py-5 text-center shadow-[var(--shadow)]">
        <div className="text-sm font-medium text-[var(--text)]">Drop files to attach</div>
        <div className="mt-1 text-xs text-white/45">Images and text-like files are supported</div>
      </div>
    </div>
  );
}
