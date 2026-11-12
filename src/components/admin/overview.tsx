import type { ReactNode } from "react";

import type { CheckStatus, ConfigCheck } from "@/lib/admin/configuration";

/*
 * Building blocks of the super admin page (#250). Server components: the page has no interaction
 * beyond links, so nothing here ships JavaScript.
 */

const STATUS_CLASSES: Record<CheckStatus, string> = {
  ok: "border-success/40 text-success",
  info: "border-line-strong text-muted",
  attention: "border-warning/50 text-warning",
};

/** The state of one check. The words carry the meaning; the color only repeats it. */
export function StatusPill({ status, children }: { status: CheckStatus; children: ReactNode }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {status === "attention" ? <span className="sr-only">Needs attention: </span> : null}
      {children}
    </span>
  );
}

/** A titled panel, like the settings and account sections. */
export function Panel({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="mt-8 rounded-xl border border-line bg-panel">
      <div className="border-b border-line px-6 py-4">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h2>
        {description === undefined ? null : <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * A table that scrolls sideways on a narrow screen. The scroll container is focusable and named,
 * so a keyboard user can scroll it too. Cells wrap above the minimum width.
 */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent">
      <table className="w-full min-w-[40rem] text-left text-sm">{children}</table>
    </div>
  );
}

// The outer cells line up with the panel's own padding.
const CELL_SPACING = "px-3 py-3 first:pl-6 last:pr-6";

export function HeaderCell({ children, numeric = false }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th scope="col" className={`border-b border-line font-medium text-muted ${CELL_SPACING} ${numeric ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

/** The first cell of a row, naming what the row is about. */
export function RowHeader({ children }: { children: ReactNode }) {
  return (
    <th scope="row" className={`text-left align-top font-medium ${CELL_SPACING}`}>
      {children}
    </th>
  );
}

export function Cell({ children, numeric = false }: { children: ReactNode; numeric?: boolean }) {
  return <td className={`align-top ${CELL_SPACING} ${numeric ? "text-right tabular-nums" : ""}`}>{children}</td>;
}

/** One configuration check as a table row: setting, state, what it means, and its variables. */
export function CheckRow({ check }: { check: ConfigCheck }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <RowHeader>{check.name}</RowHeader>
      <Cell>
        <StatusPill status={check.status}>{check.summary}</StatusPill>
      </Cell>
      <Cell>
        <span className="block leading-6">{check.detail}</span>
      </Cell>
      <Cell>
        {check.variables.length === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {check.variables.map((variable) => (
              <li key={variable}>
                <code className="font-mono text-xs break-all">{variable}</code>
              </li>
            ))}
          </ul>
        )}
      </Cell>
    </tr>
  );
}
