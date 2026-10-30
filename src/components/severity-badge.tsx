export type Severity = "Alert" | "Failed" | "Summary" | "Event";

const SEVERITY_CLASSES: Record<Severity, string> = {
  Alert: "border-warning/40 text-warning",
  Failed: "border-danger/40 text-danger",
  Summary: "border-line text-muted",
  Event: "border-line text-muted",
};

/** Event severity as a text pill, so color is never the only carrier of meaning. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${SEVERITY_CLASSES[severity]}`}
    >
      {severity}
    </span>
  );
}
