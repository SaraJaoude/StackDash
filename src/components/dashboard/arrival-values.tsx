"use client";

import { createContext, useContext, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useArrivalHighlight, useArrivalReport, useRenderDiff, type RenderDiff } from "@/components/app/arrivals";
import {
  barPercent,
  barScaleFrom,
  changedValueKeys,
  countRange,
  formatCount,
  type CountFormat,
  type CountRange,
  type ValueMap,
} from "@/lib/realtime/arrivals";

/**
 * Dashboard values that changed in a live refresh (#171): the card pulses once and shows
 * "Updated", each changed number counts from its old value, a usage bar grows or shrinks to its new
 * width, and today's trend point draws in and pings. The settled value is always the server's own
 * text; the motion only runs between the old and new values.
 */

const CardContext = createContext<RenderDiff<ValueMap>>({ previous: null, batch: 0 });

/**
 * Wraps a card's content. The card element must be `relative isolate`, so the pulse sits behind
 * the content and the label on the card's top edge, both out of the layout.
 */
export function ArrivalCard({ values, label, children }: { values: ValueMap; label: string; children: ReactNode }) {
  const diff = useRenderDiff(values, JSON.stringify(values));
  const changed = changedValueKeys(diff.previous, values).length > 0;
  const highlighted = useArrivalHighlight(diff.batch, changed);
  useArrivalReport(diff.batch, changed ? { kind: "updated", label } : null);
  return (
    <CardContext value={diff}>
      {highlighted ? (
        <>
          {/* Keyed by batch, so a second change while highlighted pulses again. */}
          <span
            key={diff.batch}
            aria-hidden="true"
            className="arrival-pulse pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
          />
          {/* Text as well as the glow, so the highlight never rests on color alone. */}
          <span className="absolute -top-2 right-3 rounded-full border border-accent bg-background px-1.5 font-mono text-[10px] leading-4 text-accent">
            Updated
          </span>
        </>
      ) : null}
      {children}
    </CardContext>
  );
}

/**
 * A number inside an ArrivalCard. When its value changed, the server's text stays in place (and in
 * the accessibility tree) but transparent while a copy counts from the old value to the new one.
 */
export function ArrivalNumber({
  valueKey,
  value,
  text,
  format,
  className = "",
}: {
  valueKey: string;
  value: number;
  /** The value as the server printed it. */
  text: string;
  format: CountFormat;
  className?: string;
}) {
  const { previous, batch } = useContext(CardContext);
  const from = previous?.[valueKey];
  const range = typeof from === "number" ? countRange(from, value) : null;
  const [doneBatch, setDoneBatch] = useState(0);
  const counting = range !== null && doneBatch !== batch;
  return (
    <span className={`relative inline-block ${className}`}>
      <span className={counting ? "opacity-0" : undefined}>{text}</span>
      {counting ? <CountingCopy key={batch} range={range} format={format} onDone={() => setDoneBatch(batch)} /> : null}
    </span>
  );
}

/**
 * The counting copy. The `count-up` keyframe in globals.css interpolates `--count` from
 * `--count-from` to `--count-to` with the landing page's timing; each frame reads it and prints it
 * with the app's own formatter, so a count reads like the value it settles on. Under reduced motion
 * the animation is off, the first frame already holds the new value, and the copy goes away.
 */
function CountingCopy({ range, format, onDone }: { range: CountRange; format: CountFormat; onDone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const paint = useEffectEvent((element: HTMLElement) => {
    const count = Number.parseFloat(getComputedStyle(element).getPropertyValue("--count"));
    element.textContent = formatCount(Number.isNaN(count) ? range.to : count, range.scale, format);
  });
  const finish = useEffectEvent(onDone);

  // Mounted once per batch (keyed by it), so this runs once per count.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    let frame = 0;
    function tick(): void {
      if (element === null) return;
      paint(element);
      if (element.getAnimations().some((animation) => animation.playState === "running")) {
        frame = window.requestAnimationFrame(tick);
      } else {
        finish();
      }
    }
    // Painted before the browser paints, so the number never blinks out.
    paint(element);
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="arrival-count absolute inset-y-0 left-0 whitespace-nowrap"
      style={{ "--count-from": range.from, "--count-to": range.to }}
    />
  );
}

/** A usage bar inside an ArrivalCard: it grows or shrinks from its old width with a transform. */
export function ArrivalBar({ valueKey, percent, className }: { valueKey: string; percent: number; className: string }) {
  const { previous, batch } = useContext(CardContext);
  const from = previous?.[valueKey];
  const scale = typeof from === "number" ? barScaleFrom(from, percent) : null;
  return (
    <div
      // Remounted per batch, so a second change animates again.
      key={batch}
      className={`h-full rounded-full ${className} ${scale === null ? "" : "arrival-bar"}`}
      style={{ width: `${barPercent(percent)}%`, ...(scale === null ? {} : { "--bar-from": scale }) }}
    />
  );
}

// Room past each end of the segment, so the reveal never clips its round caps.
const REVEAL_PAD = 4;

/**
 * The newest point of a trend chart (today, or this month), inside TrendChart's SVG. When it is new
 * or its value changed, the segment leading to it (`children`) draws in left to right, revealed by
 * a clip that grows with the landing page's `bar-fill` keyframe, and a ring pings once around the
 * point.
 */
export function ArrivalTrendLatest({
  bucket,
  value,
  segmentX,
  point,
  children,
}: {
  bucket: string;
  value: number | null;
  /** Where the segment into the newest point starts and ends; null when there is none. */
  segmentX: Readonly<{ from: number; to: number }> | null;
  /** Where the newest point sits; null when its value is unavailable. */
  point: Readonly<{ cx: number; cy: number }> | null;
  /** The segment into the newest point, as TrendChart draws it. */
  children?: ReactNode;
}) {
  const clipId = useId();
  const diff = useRenderDiff({ bucket, value }, `${bucket}:${value}`);
  const changed =
    diff.previous !== null && value !== null && (diff.previous.bucket !== bucket || diff.previous.value !== value);
  const highlighted = useArrivalHighlight(diff.batch, changed);
  const reveal = highlighted && segmentX !== null;
  return (
    <>
      {reveal ? (
        <clipPath id={clipId}>
          <rect
            key={diff.batch}
            x={segmentX.from - REVEAL_PAD}
            y={0}
            width={segmentX.to - segmentX.from + 2 * REVEAL_PAD}
            height="100%"
            className="arrival-draw"
          />
        </clipPath>
      ) : null}
      <g clipPath={reveal ? `url(#${clipId})` : undefined}>{children}</g>
      {highlighted && point !== null ? (
        <circle
          key={diff.batch}
          cx={point.cx}
          cy={point.cy}
          r={4}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="arrival-ping"
          data-testid="trend-ping"
        />
      ) : null}
    </>
  );
}
