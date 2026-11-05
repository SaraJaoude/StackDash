import Link from "next/link";

import {
  MARKER_CATEGORIES,
  markerCategoryLabel,
  markerCountText,
  markerLabel,
  type MarkerCategory,
  type TrendMarker,
} from "@/lib/dashboard/markers";
import type { TrendGranularity } from "@/lib/dashboard/trends";

/**
 * Event markers under a trend chart (#168): one row per category, one marker per bucket with
 * events, each a link to the timeline filtered to the events it counts. Meaning is carried by
 * shape and text, never by color: each category has its own shape, named in the legend, and each
 * marker's name ("14 deployments on 2026-10-21") is shown on hover and keyboard focus. The marker
 * grows with its count, so a burst stands out. In the DOM, markers run oldest bucket first and
 * then in category order, which is the keyboard order.
 */

/** Width of one marker slot and the least distance between bucket centers, in CSS pixels. */
export const MARKER_SLOT_PX = 28;

const SHAPE_MIN_PX = 10;
const SHAPE_MAX_PX = 20;

const SHAPE_PATHS: Readonly<Record<MarkerCategory, string>> = {
  deployments: "M10 2 L18.5 17 L1.5 17 Z",
  payments: "M10 2 A8 8 0 1 1 10 18 A8 8 0 1 1 10 2 Z",
  signups: "M3 3 H17 V17 H3 Z",
  stars: "M10 1.5 L12.6 7.2 L18.8 7.6 L14 11.6 L15.5 17.8 L10 14.5 L4.5 17.8 L6 11.6 L1.2 7.6 L7.4 7.2 Z",
  alerts: "M10 1 L19 10 L10 19 L1 10 Z",
};

/** The category's shape: a triangle, circle, square, star, or diamond. Decorative. */
export function MarkerShape({
  category,
  size = 12,
  filled = true,
}: {
  category: MarkerCategory;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <path
        d={SHAPE_PATHS[category]}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Categories with at least one marker, in category order. */
export function markerLanes(markers: readonly TrendMarker[]): MarkerCategory[] {
  return MARKER_CATEGORIES.filter((category) => markers.some((marker) => marker.category === category));
}

export function TrendMarkers({
  markers,
  granularity,
  positions,
}: {
  markers: readonly TrendMarker[];
  granularity: TrendGranularity;
  /** Each bucket's horizontal position, as a percent of the chart's width. */
  positions: ReadonlyMap<string, number>;
}) {
  const lanes = markerLanes(markers);
  const largest = new Map(
    lanes.map((category) => [
      category,
      Math.max(...markers.filter((marker) => marker.category === category).map((marker) => marker.count)),
    ]),
  );
  const byBucket = new Map<string, TrendMarker[]>();
  for (const marker of markers) byBucket.set(marker.bucket, [...(byBucket.get(marker.bucket) ?? []), marker]);

  return (
    <ul aria-label="Event markers" className="relative mt-2" style={{ height: lanes.length * MARKER_SLOT_PX }}>
      {[...byBucket].map(([bucket, items]) => {
        const left = positions.get(bucket);
        if (left === undefined) return null;
        return (
          <li key={bucket} className="absolute top-0 flex -translate-x-1/2 flex-col" style={{ left: `${left}%` }}>
            {lanes.map((category) => {
              const marker = items.find((item) => item.category === category);
              if (marker === undefined) return <span key={category} aria-hidden="true" className="block size-7" />;
              const label = markerLabel(marker, granularity);
              // Square root, so a count four times larger reads as a shape twice the size.
              const share = Math.sqrt(marker.count / (largest.get(category) ?? marker.count));
              return (
                <span key={category} className="flex size-7 items-center justify-center">
                  {/* One link per marker in view: prefetching each would load the timeline dozens of times. */}
                  <Link
                    href={marker.href}
                    prefetch={false}
                    aria-label={label}
                    className="group relative flex size-6 items-center justify-center rounded text-muted transition-colors hover:text-foreground focus-visible:text-foreground"
                  >
                    <MarkerShape category={category} size={Math.round(SHAPE_MIN_PX + (SHAPE_MAX_PX - SHAPE_MIN_PX) * share)} />
                    {/* The visible form of the link's name, for pointer and keyboard users alike. */}
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-line-strong bg-panel-raised px-2 py-1 text-xs text-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 ${
                        left < 50 ? "left-0" : "right-0"
                      }`}
                    >
                      {label}
                    </span>
                  </Link>
                </span>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}

/** Legend entries for the categories on the chart. */
export function MarkerLegend({ lanes }: { lanes: readonly MarkerCategory[] }) {
  return (
    <>
      {lanes.map((category) => (
        <li key={category} className="flex items-center gap-2">
          <MarkerShape category={category} />
          {`Marker: ${markerCategoryLabel(category).toLowerCase()}`}
        </li>
      ))}
      <li>Larger markers count more events. Point at or focus a marker for its count.</li>
    </>
  );
}

/** The table's "Events" cell for one bucket: each count links to the same timeline view. */
export function MarkerCounts({ markers }: { markers: readonly TrendMarker[] }) {
  if (markers.length === 0) return <span className="text-muted">No events</span>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {markers.map((marker) => (
        <li key={marker.category} className="flex items-center gap-1.5">
          <MarkerShape category={marker.category} size={10} />
          <Link
            href={marker.href}
            prefetch={false}
            className="inline-flex min-h-6 items-center underline underline-offset-4 hover:text-foreground"
          >
            {markerCountText(marker.category, marker.count)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
