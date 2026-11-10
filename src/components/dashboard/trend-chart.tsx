import { useId } from "react";

import { SimulatedBadge } from "@/components/connections/simulated-badge";
import type { TrendMarker } from "@/lib/dashboard/markers";
import {
  bucketLabel,
  comparisonText,
  formatTrendValue,
  seriesTitle,
  trendSummary,
  trendWindowLabel,
  type TrendSeries,
} from "@/lib/dashboard/trends";

import { ArrivalTrendLatest } from "./arrival-values";
import { MARKER_SLOT_PX, MarkerCounts, MarkerLegend, markerLanes, TrendMarkers } from "./trend-markers";

// Drawing space in SVG user units; the SVG scales to its container width.
const WIDTH = 640;
const HEIGHT = 180;
const PAD_X = 8;
const PAD_Y = 12;
const GAP_MARK = 6;
const ESTIMATE_DASH = "6 4";

/**
 * One trend series as an inline SVG line chart with a table of the same values. Server rendered;
 * the only motion is today's point drawing in and pinging when a live refresh changes it (#171),
 * which reduced motion turns into a static ring. Meaning never rests on color: estimated values
 * use a dashed line and hollow points, gaps break the line and carry a mark on the baseline, and
 * `TrendLegend`, shared by every chart in the section (#263), says so in words. The chart is one
 * image whose accessible name summarizes the trend; the table holds every value.
 *
 * `markers` are the event markers drawn under the chart and listed in the table's "Events"
 * column (#168); null when every marker category is hidden, which drops the column too.
 */
export function TrendChart({ series, markers }: { series: TrendSeries; markers: readonly TrendMarker[] | null }) {
  const titleId = useId();
  const tableId = useId();
  const { points, measure, granularity } = series;
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const low = Math.min(0, ...values);
  const high = Math.max(...values);
  const span = high > low ? high - low : 1;
  const plotWidth = WIDTH - 2 * PAD_X;
  const plotHeight = HEIGHT - 2 * PAD_Y;
  const x = (index: number) => PAD_X + (points.length > 1 ? (index / (points.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value: number) => PAD_Y + (1 - (value - low) / span) * plotHeight;
  const baseline = HEIGHT - PAD_Y;
  const first = points[0];
  const last = points.at(-1);
  const lastIndex = points.length - 1;
  const lanes = markerLanes(markers ?? []);
  // Each bucket's position as a percent of the width, so markers line up with the points.
  const positions = new Map(points.map((point, index) => [point.bucket, (x(index) / WIDTH) * 100]));
  // Wide enough that markers on neighboring buckets never overlap; narrower screens scroll the
  // chart sideways instead of shrinking the 24 pixel targets.
  const minWidth =
    lanes.length === 0 ? undefined : Math.ceil((Math.max(points.length - 1, 1) * MARKER_SLOT_PX * WIDTH) / plotWidth);

  /** The line from the point before `index` to it; null across a gap. */
  function segment(index: number) {
    const point = points[index];
    const previous = points[index - 1];
    if (point === undefined || previous === undefined || previous.value === null || point.value === null) return null;
    return (
      <line
        key={`segment-${point.bucket}`}
        x1={x(index - 1)}
        y1={y(previous.value)}
        x2={x(index)}
        y2={y(point.value)}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={previous.estimated || point.estimated ? ESTIMATE_DASH : undefined}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  const lastSegment = segment(lastIndex);

  return (
    <figure aria-labelledby={titleId} className="rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={titleId} className="font-semibold">
          {seriesTitle(series)}
        </h4>
        {series.simulated ? <SimulatedBadge /> : null}
      </div>
      <p className="mt-1 text-sm text-muted">{comparisonText(series.comparison, measure, granularity)}</p>

      <div className={lanes.length === 0 ? "mt-4" : "mt-4 overflow-x-auto px-2"}>
        <div style={minWidth === undefined ? undefined : { minWidth }}>
          <svg
            role="img"
            aria-label={trendSummary(series)}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full text-accent"
          >
            <line x1={PAD_X} x2={WIDTH - PAD_X} y1={PAD_Y} y2={PAD_Y} className="stroke-line-strong" strokeWidth={1} />
            <line x1={PAD_X} x2={WIDTH - PAD_X} y1={baseline} y2={baseline} className="stroke-line-strong" strokeWidth={1} />
            {points.map((_, index) => (index === lastIndex ? null : segment(index)))}
            {last === undefined ? null : (
              <ArrivalTrendLatest
                bucket={last.bucket}
                value={last.value}
                segmentX={lastSegment === null ? null : { from: x(lastIndex - 1), to: x(lastIndex) }}
                point={last.value === null ? null : { cx: x(lastIndex), cy: y(last.value) }}
              >
                {lastSegment}
              </ArrivalTrendLatest>
            )}
            {points.map((point, index) =>
              point.value === null ? (
                <line
                  key={`gap-${point.bucket}`}
                  x1={x(index)}
                  x2={x(index)}
                  y1={baseline - GAP_MARK}
                  y2={baseline}
                  className="stroke-muted"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <circle
                  key={`point-${point.bucket}`}
                  cx={x(index)}
                  cy={y(point.value)}
                  r={3}
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className={point.estimated ? "fill-panel" : "fill-current"}
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
          </svg>

          {lanes.length === 0 ? null : (
            <TrendMarkers markers={markers ?? []} granularity={granularity} positions={positions} skipTo={tableId} />
          )}

          {/* Axis labels are in the table and the chart's name already, so screen readers skip them here. */}
          <div aria-hidden="true" className="mt-1 flex justify-between gap-4 font-mono text-xs text-muted">
            <span>{first === undefined ? "" : bucketLabel(first.bucket, granularity)}</span>
            <span>
              {values.length === 0 ? "" : `High ${formatTrendValue(high, measure)}, low ${formatTrendValue(Math.min(...values), measure)}`}
            </span>
            <span>{last === undefined ? "" : bucketLabel(last.bucket, granularity)}</span>
          </div>
        </div>
      </div>

      {/* The skip link past the markers lands here, so the next Tab reaches the table's control. */}
      <details id={tableId} className="mt-4">
        <summary className="inline-flex min-h-6 cursor-pointer items-center text-sm font-medium underline underline-offset-4">
          Show the values as a table
        </summary>
        <div className="mt-3">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-xs text-muted">
              {`${seriesTitle(series)}: ${granularity === "daily" ? "daily" : "monthly"} values for the ${trendWindowLabel(granularity)}`}
            </caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {granularity === "daily" ? "Day (UTC)" : "Month (UTC)"}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Value
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Source
                </th>
                {markers === null ? null : (
                  <th scope="col" className="py-2 font-medium">
                    Events
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.bucket} className="border-b border-line">
                  <th scope="row" className="py-2 pr-4 font-mono font-normal">
                    {bucketLabel(point.bucket, granularity)}
                  </th>
                  <td className="py-2 pr-4 font-mono tabular-nums">
                    {point.value === null ? (
                      <span className="text-muted">Unavailable</span>
                    ) : (
                      formatTrendValue(point.value, measure)
                    )}
                  </td>
                  <td className="py-2 pr-4">{point.value === null ? "No data" : point.estimated ? "Estimated" : "Verified"}</td>
                  {markers === null ? null : (
                    <td className="py-2">
                      <MarkerCounts markers={markers.filter((marker) => marker.bucket === point.bucket)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/**
 * One legend for every chart in the trends section (#263), listing what the charts on the page
 * draw: line styles for the values they hold and a shape for each marker category they show.
 */
export function TrendLegend({ series, markers }: { series: readonly TrendSeries[]; markers: readonly TrendMarker[] }) {
  const points = series.flatMap((entry) => entry.points);
  const hasEstimates = points.some((point) => point.value !== null && point.estimated);
  const hasGaps = points.some((point) => point.value === null);
  const lanes = markerLanes(markers);
  return (
    <ul aria-label="Legend for every chart" className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      <li className="flex items-center gap-2">
        <LegendLine dashed={false} />
        Solid line, filled points: verified
      </li>
      {hasEstimates ? (
        <li className="flex items-center gap-2">
          <LegendLine dashed />
          Dashed line, hollow points: estimated
        </li>
      ) : null}
      {hasGaps ? (
        <li className="flex items-center gap-2">
          <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" className="text-muted">
            <line x1={6} x2={6} y1={4} y2={12} stroke="currentColor" strokeWidth={2} />
          </svg>
          Break in the line, mark on the baseline: unavailable
        </li>
      ) : null}
      {lanes.length === 0 ? null : <MarkerLegend lanes={lanes} />}
    </ul>
  );
}

function LegendLine({ dashed }: { dashed: boolean }) {
  return (
    <svg width={28} height={10} viewBox="0 0 28 10" aria-hidden="true" className="text-accent">
      <line x1={2} x2={20} y1={5} y2={5} stroke="currentColor" strokeWidth={2} strokeDasharray={dashed ? "4 3" : undefined} />
      <circle cx={23} cy={5} r={3} stroke="currentColor" strokeWidth={1.5} className={dashed ? "fill-panel" : "fill-current"} />
    </svg>
  );
}
