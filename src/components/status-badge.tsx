/** Pill beside the wordmark stating the project stage, so no visitor mistakes this for a live product. */
export function StatusBadge() {
  return (
    <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase leading-none tracking-widest text-muted">
      In development
    </span>
  );
}
