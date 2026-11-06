"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { useArrivalHighlight, useArrivalReport, useRenderDiff } from "@/components/app/arrivals";
import { newEventIds } from "@/lib/realtime/arrivals";

/**
 * Timeline events that arrived in a live refresh (#171). The list compares its ids with the
 * previous render; a new row slides into its day group with a severity-colored edge and wash that
 * fade, and says "New" while highlighted. Rows already on screen never move or animate.
 */

type Arrivals = Readonly<{
  /** Arrived in the latest batch. */
  newIds: ReadonlySet<string>;
  /** Arrived in any batch since this view opened: these rows keep the space of their label. */
  labeledIds: ReadonlySet<string>;
  highlighted: boolean;
}>;

const ArrivalsContext = createContext<Arrivals>({ newIds: new Set(), labeledIds: new Set(), highlighted: false });

/** Around the whole list, with the ids of every event it shows. */
export function ArrivalEvents({ eventIds, children }: { eventIds: readonly string[]; children: ReactNode }) {
  const diff = useRenderDiff(eventIds, eventIds.join(" "));
  const arrived = newEventIds(diff.previous, eventIds);
  // Grows with every batch and empties when the view changes (no previous render), so a label is
  // never removed from a row while the view is open: removing it could reflow the row.
  const [labeled, setLabeled] = useState<Readonly<{ batch: number; ids: readonly string[] }>>({ batch: 0, ids: [] });
  let labeledIds = labeled.ids;
  if (labeled.batch !== diff.batch || (diff.previous === null && labeled.ids.length > 0)) {
    labeledIds = diff.previous === null ? [] : [...labeled.ids, ...arrived];
    setLabeled({ batch: diff.batch, ids: labeledIds });
  }
  const highlighted = useArrivalHighlight(diff.batch, arrived.length > 0);
  useArrivalReport(diff.batch, arrived.length > 0 ? { kind: "events", count: arrived.length } : null);
  return (
    <ArrivalsContext value={{ newIds: new Set(arrived), labeledIds: new Set(labeledIds), highlighted }}>
      {children}
    </ArrivalsContext>
  );
}

/**
 * One event's list item. A new row mounts with the slide in, so it runs once; the edge and wash
 * (or, under reduced motion, a static highlight) stay only while the arrival is highlighted.
 */
export function ArrivalEventRow({
  eventId,
  flash,
  className,
  children,
}: {
  eventId: string;
  /** The severity color of the arriving edge, as a CSS color. */
  flash: string;
  className: string;
  children: ReactNode;
}) {
  const { newIds, highlighted } = useContext(ArrivalsContext);
  const arrived = newIds.has(eventId);
  return (
    <li className={`relative isolate ${className} ${arrived ? "arrival-enter" : ""}`}>
      {arrived && highlighted ? (
        <span
          aria-hidden="true"
          className="arrival-flash pointer-events-none absolute inset-0 -z-10"
          style={{ "--flash": flash }}
        />
      ) : null}
      {children}
    </li>
  );
}

/**
 * "New" after a new event's details, so the highlight never rests on color alone. Once the
 * highlight ends it is hidden but keeps its space.
 */
export function ArrivalNewLabel({ eventId }: { eventId: string }) {
  const { newIds, labeledIds, highlighted } = useContext(ArrivalsContext);
  if (!labeledIds.has(eventId)) return null;
  const visible = highlighted && newIds.has(eventId);
  return (
    <span
      className={`ml-2 rounded-full border border-accent px-1.5 font-mono text-[10px] text-accent ${visible ? "" : "invisible"}`}
    >
      <span className="sr-only">, </span>
      New
    </span>
  );
}
