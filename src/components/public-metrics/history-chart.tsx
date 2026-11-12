import { useId } from "react";

import { SimulatedBadge } from "@/components/connections/simulated-badge";
import { historySummary, type ChartPoint } from "@/lib/public-metrics/history";
import type { PublishedHistoryPoint } from "@/lib/public-metrics/published";

// Drawing space in SVG user units; the SVG scales to its container width.
const WIDTH = 480;
const HEIGHT = 140;
const PAD_X = 6;
const PAD_Y = 10;
const GAP_MARK = 6;

/**
 * A published metric's history (#150) as an inline SVG line chart, with the same values in a table.
 * Drawn like the dashboard's trend chart (src/components/dashboard/trend-chart.tsx) but without its
 * live arrival animation, which needs the signed-in app's realtime channel. The chart is one image
 * whose accessible name summarizes the whole period; the table holds every value. The `recent`
 * window at the end of the period is stated as a sentence rather than drawn again, so each metric
 * has one chart (#344). Days without a value break the line and carry a mark on the baseline, said
 * in words in the legend.
 */
export function HistoryChart({
  title,
  period,
  recent,
  points,
}: {
  title: string;
  /** "last 90 days", lowercase: it continues the title in sentences. */
  period: string;
  /** The last `days` points, summarized in words beside the chart under their own `period`. */
  recent: Readonly<{ days: number; period: string }>;
  points: readonly PublishedHistoryPoint[];
}) {
  const captionId = useId();
  const chartPoints: ChartPoint[] = points.map((point) => ({
    asOf: point.asOf,
    value: point.value.status === "available" ? point.value.value : null,
    text: point.value.text,
  }));
  const values = chartPoints.flatMap((point) => (point.value === null ? [] : [point.value]));
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high > low ? high - low : 1;
  const plotWidth = WIDTH - 2 * PAD_X;
  const plotHeight = HEIGHT - 2 * PAD_Y;
  const x = (index: number) => PAD_X + (chartPoints.length > 1 ? (index / (chartPoints.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value: number) => PAD_Y + (1 - (value - low) / span) * plotHeight;
  const baseline = HEIGHT - PAD_Y;
  const hasGaps = chartPoints.some((point) => point.value === null);
  const simulated = points.some((point) => point.value.status === "available" && point.value.simulated);
  const first = chartPoints[0];
  const last = chartPoints.at(-1);
  const available = chartPoints.filter((point) => point.value !== null);
  const highest = available.reduce<ChartPoint | undefined>((best, point) => (best === undefined || (point.value ?? 0) > (best.value ?? 0) ? point : best), undefined);
  const lowest = available.reduce<ChartPoint | undefined>((best, point) => (best === undefined || (point.value ?? 0) < (best.value ?? 0) ? point : best), undefined);

  return (
    <figure aria-labelledby={captionId} className="rounded-xl border border-line bg-panel p-5">
      <figcaption className="flex flex-wrap items-center gap-2">
        <span id={captionId} className="font-semibold">
          {title}, {period}
        </span>
        {simulated ? <SimulatedBadge /> : null}
      </figcaption>

      <div className="mt-4 grid gap-x-6 gap-y-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <svg role="img" aria-label={historySummary(title, period, chartPoints)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full text-accent">
            <line x1={PAD_X} x2={WIDTH - PAD_X} y1={baseline} y2={baseline} className="stroke-line-strong" strokeWidth={1} />
            {chartPoints.map((point, index) => {
              const previous = chartPoints[index - 1];
              if (previous === undefined || previous.value === null || point.value === null) return null;
              return (
                <line
                  key={`segment-${point.asOf.toISOString()}`}
                  x1={x(index - 1)}
                  y1={y(previous.value)}
                  x2={x(index)}
                  y2={y(point.value)}
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {chartPoints.map((point, index) =>
              point.value === null ? (
                <line
                  key={`gap-${point.asOf.toISOString()}`}
                  x1={x(index)}
                  x2={x(index)}
                  y1={baseline - GAP_MARK}
                  y2={baseline}
                  className="stroke-muted"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          </svg>

          {/* The dates and range are in the chart's name and the table, so screen readers skip them here. */}
          <div aria-hidden="true" className="mt-1 flex justify-between gap-4 font-mono text-xs text-muted">
            <span className="shrink-0">{first === undefined ? "" : utcDay(first.asOf)}</span>
            <span className="min-w-0 text-center">{highest === undefined || lowest === undefined ? "" : `High ${highest.text}, low ${lowest.text}`}</span>
            <span className="shrink-0">{last === undefined ? "" : utcDay(last.asOf)}</span>
          </div>

          {hasGaps ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" className="text-muted">
                <line x1={6} x2={6} y1={4} y2={12} stroke="currentColor" strokeWidth={2} />
              </svg>
              Break in the line, mark on the baseline: no value that day
            </p>
          ) : null}
        </div>

        <p className="text-sm leading-6">{historySummary(title, recent.period, chartPoints.slice(-recent.days))}</p>
      </div>

      <details className="mt-4">
        <summary className="inline-flex min-h-6 cursor-pointer items-center text-sm font-medium underline underline-offset-4">
          Show the values as a table<span className="sr-only">: {title}, {period}</span>
        </summary>
        <div className="mt-3 max-h-80 overflow-y-auto" tabIndex={0} aria-label={`${title}, ${period}, values`} role="region">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-xs text-muted">{`${title}: daily values for the ${period}`}</caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Day (UTC)
                </th>
                <th scope="col" className="py-2 font-medium">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {chartPoints.map((point) => (
                <tr key={point.asOf.toISOString()} className="border-b border-line">
                  <th scope="row" className="py-2 pr-4 font-mono font-normal">
                    {utcDay(point.asOf)}
                  </th>
                  <td className={point.value === null ? "py-2 text-muted" : "py-2 font-mono tabular-nums"}>{point.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
