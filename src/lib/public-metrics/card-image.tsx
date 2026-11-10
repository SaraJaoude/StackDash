import "server-only";

import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

import { formatDateTime } from "@/lib/format";

import type { PublishedMetricCard } from "./published";
import { CARD_SIZE, CARD_TREND_DAYS, provenanceSentence, shareableMetric } from "./share";
import { isYearComplete, yearFigures, yearPeriod, yearProvenance, yearSummaryLabel, type YearSummary } from "./yearly";

/*
 * The 1200 by 630 PNG cards (#149 milestone cards, #151 yearly card), rendered with Next.js'
 * `ImageResponse` (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * image-response.md): JSX laid out by Satori with flexbox only, no external image service, and the
 * renderer's bundled font, so no font file ships with the route. Colors are the site's tokens
 * (src/app/globals.css); text is at least 4.5:1 against the background.
 */

const COLORS = {
  background: "#0a0a0a",
  panel: "#16161a",
  line: "#2a2a30",
  foreground: "#ededed",
  muted: "#a1a1aa",
  accent: "#ff5d3b",
  success: "#3ecf8e",
  warning: "#f5a623",
} as const;

const PADDING_PX = 64;
const TREND_WIDTH_PX = CARD_SIZE.width - 2 * PADDING_PX;
const TREND_HEIGHT_PX = 150;
const TREND_STROKE_PX = 5;

/**
 * An SVG path through the points that have a value, scaled into `width` by `height`. A missing
 * point breaks the line instead of drawing a slope across a gap; a flat series sits mid-height.
 * Null when fewer than two points have a value, since one point is not a trend.
 */
export function trendPath(values: readonly (number | null)[], width: number, height: number): string | null {
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2 || values.length < 2) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const inset = TREND_STROKE_PX;
  const usable = height - 2 * inset;
  const x = (index: number) => Math.round(((index / (values.length - 1)) * width) * 10) / 10;
  const y = (value: number) =>
    Math.round((max === min ? height / 2 : inset + usable - ((value - min) / (max - min)) * usable) * 10) / 10;
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${x(index)} ${y(value)} `;
    drawing = true;
  });
  return path.trim();
}

function Frame({ tag, children, footer }: { tag: ReactNode; children: ReactNode; footer: readonly [string, string] }) {
  return (
    <div
      style={{
        // In pixels: with height 100% the frame took its content's height, leaving a white band under short cards.
        width: CARD_SIZE.width,
        height: CARD_SIZE.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: PADDING_PX,
        backgroundColor: COLORS.background,
        color: COLORS.foreground,
        fontSize: 28,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 36, color: COLORS.accent, letterSpacing: -1 }}>DevMacro</div>
        {tag}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", color: COLORS.muted, fontSize: 24 }}>
        <div style={{ display: "flex" }}>{footer[0]}</div>
        <div style={{ display: "flex" }}>{footer[1]}</div>
      </div>
    </div>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "8px 20px",
        borderRadius: 999,
        border: `2px solid ${color}`,
        color,
        fontSize: 24,
      }}
    >
      {text}
    </div>
  );
}

function Trend({ values }: { values: readonly (number | null)[] }) {
  const path = trendPath(values, TREND_WIDTH_PX, TREND_HEIGHT_PX);
  if (path === null) {
    return <div style={{ display: "flex", height: TREND_HEIGHT_PX, alignItems: "center", color: COLORS.muted }}>No trend to show yet</div>;
  }
  return (
    <svg width={TREND_WIDTH_PX} height={TREND_HEIGHT_PX} viewBox={`0 0 ${TREND_WIDTH_PX} ${TREND_HEIGHT_PX}`}>
      <path d={path} fill="none" stroke={COLORS.accent} strokeWidth={TREND_STROKE_PX} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The milestone card of one published metric: label, value, provenance, trend, last sync. */
export function MetricCard({ card }: { card: PublishedMetricCard }) {
  const { metric, trend } = card;
  const share = shareableMetric(metric);
  const tag = share.simulated ? (
    <Tag text={provenanceSentence(share)} color={COLORS.warning} />
  ) : share.available ? (
    <Tag text={provenanceSentence(share)} color={COLORS.success} />
  ) : (
    <Tag text="No current value" color={COLORS.muted} />
  );
  const window = metric.delayDays === 0 ? `Trend over the last ${CARD_TREND_DAYS} days` : `As of ${formatDateTime(metric.asOf)}, ${metric.delayDays} days late`;
  const synced = share.lastSyncedAt === null ? "Not synced recently" : `Last synced ${formatDateTime(share.lastSyncedAt)}`;
  return (
    <Frame tag={tag} footer={[window, synced]}>
      <div style={{ display: "flex", fontSize: 40, color: COLORS.muted }}>{metric.label}</div>
      <div style={{ display: "flex", fontSize: share.available ? 104 : 72, marginTop: 8, marginBottom: 24, letterSpacing: -2 }}>{share.text}</div>
      <Trend values={trend.map((point) => point.value)} />
    </Frame>
  );
}

/** A card with no metric behind it: not published, refused, or failed. Says which, nothing more. */
export function NoticeCard({ title, body }: { title: string; body: string }) {
  return (
    <Frame tag={<Tag text="No value shown" color={COLORS.muted} />} footer={["Public metrics, counted from stored data", ""]}>
      <div style={{ display: "flex", fontSize: 88, letterSpacing: -2 }}>{title}</div>
      <div style={{ display: "flex", fontSize: 36, marginTop: 24, color: COLORS.muted }}>{body}</div>
    </Frame>
  );
}

// The yearly card's grid, sized so two rows of figures always fit the 1200 by 630 card (#267):
// every line is one line high and ends in an ellipsis rather than wrap past its box. The page lists
// every figure in full beneath the card, and the alt text says them all.
const FIGURE_GAP_PX = 16;
const FIGURE_HEIGHT_PX = 152;
const FIGURE_PADDING_PX = 20;
const VALUE_LINE_PX = 58;
/** A count fits at full size; a reason such as "Not connected" is words and drops to a size that fits. */
const COUNT_CHARS_MAX = 12;

/** One line of card text that ends in an ellipsis instead of wrapping. */
function line(fontSize: number, color: string = COLORS.foreground) {
  return { display: "flex", fontSize, lineHeight: 1.2, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;
}

/** The private yearly summary card (#151): a whole past year, or the current year to date. */
export function YearCard({ summary }: { summary: YearSummary }) {
  const tag = isYearComplete(summary.year, summary.asOf) ? `${summary.year} in review` : "Year to date";
  return (
    <Frame
      tag={<Tag text={tag} color={summary.simulated ? COLORS.warning : COLORS.accent} />}
      footer={[yearPeriod(summary), yearProvenance(summary)]}
    >
      <div style={{ ...line(52), letterSpacing: -1, marginBottom: 24 }}>{`Your stack in ${yearSummaryLabel(summary)}`}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: FIGURE_GAP_PX }}>
        {yearFigures(summary).map((stat) => (
          <div
            key={stat.label}
            style={{
              display: "flex",
              flexDirection: "column",
              width: (TREND_WIDTH_PX - FIGURE_GAP_PX) / 2,
              height: FIGURE_HEIGHT_PX,
              padding: `16px ${FIGURE_PADDING_PX}px`,
              borderRadius: 16,
              backgroundColor: COLORS.panel,
              border: `2px solid ${COLORS.line}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", height: VALUE_LINE_PX }}>
              <div style={{ ...line(stat.value.length > COUNT_CHARS_MAX ? 28 : 52), letterSpacing: -1 }}>{stat.value}</div>
            </div>
            <div style={line(22, COLORS.muted)}>{stat.since === null ? stat.label : `${stat.label}, since ${stat.since}`}</div>
            {stat.countedUpTo === null ? null : <div style={line(22, COLORS.muted)}>{`counted up to ${stat.countedUpTo}`}</div>}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Renders a card element as the 1200 by 630 PNG every card is. */
export function cardImageResponse(element: ReactNode, init: Readonly<{ status?: number; headers: Record<string, string> }>): ImageResponse {
  return new ImageResponse(<>{element}</>, { ...CARD_SIZE, status: init.status ?? 200, headers: init.headers });
}
