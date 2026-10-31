import type { Database } from "@/lib/supabase/database.types";

type ConnectionStatus = Database["public"]["Enums"]["connection_status"];

type StatusStyle = { label: string; className: string; icon: "check" | "alert" | "cross" | "clock" };

const STATUS: Record<ConnectionStatus, StatusStyle> = {
  active: { label: "Active", className: "border-success/40 text-success", icon: "check" },
  pending: { label: "Connecting", className: "border-line text-muted", icon: "clock" },
  needs_attention: { label: "Needs attention", className: "border-warning/40 text-warning", icon: "alert" },
  failed: { label: "Failed", className: "border-danger/40 text-danger", icon: "cross" },
  revoked: { label: "Disconnected", className: "border-line-strong text-muted", icon: "cross" },
};

const ICON_PATHS: Record<StatusStyle["icon"], string> = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 8v5m0 3.5v.5M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  cross: "M6 6l12 12M18 6 6 18",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
};

/** Connection status as an icon plus words, so color is never the only signal. */
export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const style = STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      <svg
        width={12}
        height={12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={ICON_PATHS[style.icon]} />
      </svg>
      <span>
        <span className="sr-only">Status: </span>
        {style.label}
      </span>
    </span>
  );
}
