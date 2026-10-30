"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { SeverityBadge, type Severity } from "@/components/severity-badge";

type Platform =
  | "Vercel"
  | "GitHub"
  | "GitHub Actions"
  | "Resend"
  | "Stripe"
  | "Anthropic API"
  | "Supabase"
  | "ElevenLabs"
  | "OpenAI API"
  | "Cloudflare";

// Short text marks stand in for logos: no third-party artwork, and the full name is always
// printed beside the mark.
const PLATFORM_MARKS: Record<Platform, string> = {
  Vercel: "V",
  GitHub: "GH",
  "GitHub Actions": "GA",
  Resend: "R",
  Stripe: "S",
  "Anthropic API": "A",
  Supabase: "SB",
  ElevenLabs: "11",
  "OpenAI API": "AI",
  Cloudflare: "CF",
};

interface FeedEvent {
  platform: Platform;
  severity: Severity;
  text: string;
}

// Illustrative events only, labeled as such in the UI. Ordered so neighbors come from different
// platforms, because the point of the feed is many sources in one place.
const feedEvents: readonly FeedEvent[] = [
  { platform: "Vercel", severity: "Event", text: "Production deployment of acme-web is ready" },
  { platform: "GitHub", severity: "Event", text: "Pull request #128 merged in acme/api" },
  { platform: "Resend", severity: "Alert", text: "Monthly email allowance passed 80%" },
  { platform: "Stripe", severity: "Event", text: "Payment of $49.00 received for the Pro plan" },
  { platform: "GitHub Actions", severity: "Failed", text: "Workflow ci failed on main in acme/api" },
  { platform: "Anthropic API", severity: "Alert", text: "Spending passed 90% of your $25 budget" },
  { platform: "Supabase", severity: "Event", text: "Database egress reached 2.1 GB of 5 GB" },
  { platform: "ElevenLabs", severity: "Event", text: "Character credits reset for the new billing period" },
  { platform: "Vercel", severity: "Failed", text: "Preview deployment failed for acme-docs" },
  { platform: "OpenAI API", severity: "Event", text: "Spending today reached $3.10" },
  { platform: "GitHub", severity: "Event", text: "Release v1.4.0 published in acme/cli" },
  { platform: "Stripe", severity: "Failed", text: "Renewal payment failed for an annual plan" },
  { platform: "Cloudflare", severity: "Event", text: "Workers requests reached 60% of the daily allowance" },
  { platform: "Resend", severity: "Event", text: "Domain mail.acme.dev verified" },
];

// Ten rows match the height of the month column beside the feed. Below the lg breakpoint the
// columns stack, so only the first COMPACT_ROWS show.
const VISIBLE_ROWS = 10;
const COMPACT_ROWS = 6;
const TICK_SECONDS = 3;
const EVENTS_TODAY_BEFORE_FEED = 1278;

// The first render shows the first VISIBLE_ROWS events, newest on top. Server and client agree
// on it, so hydration matches and the page still prerenders statically.
const INITIAL_SEQ = VISIBLE_ROWS - 1;

// The rows present at load rise in as the hero window settles.
const INITIAL_ROWS_START_MS = 700;
const INITIAL_ROWS_STAGGER_MS = 70;

const eventCount = new Intl.NumberFormat("en-US");

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

// Motion is opt-in on the server: the static HTML renders the feed as playing, and the client
// switches it to paused on hydration when the visitor asked for reduced motion.
function serverPrefersReducedMotion(): boolean {
  return false;
}

function eventAt(seq: number): FeedEvent {
  const event = feedEvents[seq % feedEvents.length];
  if (event === undefined) throw new Error(`No feed event for sequence ${seq}`);
  return event;
}

/**
 * Example feed of realtime events from several platforms. A new event arrives every
 * TICK_SECONDS; the visitor can pause it, and it starts paused under reduced motion.
 */
export function LiveEventFeed() {
  // Every visible row derives from `seq`, the sequence number of the newest event.
  const [seq, setSeq] = useState(INITIAL_SEQ);
  // null until the visitor presses the button; until then reduced motion decides.
  const [choice, setChoice] = useState<"playing" | "paused" | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion, serverPrefersReducedMotion);
  const playing = choice === null ? !reducedMotion : choice === "playing";

  useEffect(() => {
    if (!playing) return;
    const intervalId = window.setInterval(() => setSeq((current) => current + 1), TICK_SECONDS * 1000);
    return () => window.clearInterval(intervalId);
  }, [playing]);

  // One extra row past the visible ones closes as the new row opens, so the list height holds.
  const rows: { key: number; position: number }[] = [];
  for (let position = 0; position <= VISIBLE_ROWS; position++) {
    const key = seq - position;
    if (key < 0) break;
    rows.push({ key, position });
  }

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-sm font-medium">
          <span className="relative flex size-2" aria-hidden="true">
            {playing ? <span className="live-pulse absolute inset-0 rounded-full bg-success" /> : null}
            <span className={`relative size-2 rounded-full ${playing ? "bg-success" : "bg-muted"}`} />
          </span>
          Live events
          <span className="font-mono text-xs font-normal text-muted">{playing ? "Streaming" : "Paused"}</span>
        </p>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-xs tabular-nums text-muted sm:inline">
            {eventCount.format(EVENTS_TODAY_BEFORE_FEED + seq)} events today
          </span>
          <button
            type="button"
            onClick={() => setChoice(playing ? "paused" : "playing")}
            className="min-h-7 rounded-md border border-line px-2.5 font-mono text-xs text-muted transition-colors hover:border-line-strong hover:text-foreground"
          >
            {playing ? "Pause" : "Resume"}
            <span className="sr-only"> live events</span>
          </button>
        </div>
      </div>

      <ol aria-label="Example live events" className="mt-4 overflow-hidden rounded-lg border border-line bg-panel-raised">
        {rows.map(({ key, position }) => {
          const event = eventAt(key);
          const leaving = position === VISIBLE_ROWS;
          const arriving = key > INITIAL_SEQ && position === 0;
          const initial = key <= INITIAL_SEQ;
          // Ages are whole multiples of TICK_SECONDS under a minute, so a fixed English string is
          // exact. Intl.RelativeTimeFormat output differs between the server's and the browser's
          // ICU data, which would break hydration.
          const ageSeconds = position * TICK_SECONDS;
          const rowMotion = leaving ? "feed-exit" : arriving ? "feed-enter" : "";
          // Keyed to the event, not its position, so a row's delay never changes as it moves down.
          const contentMotion = arriving ? "feed-arrival" : initial ? "rise-in" : "";
          return (
            <li
              key={key}
              aria-hidden={leaving ? true : undefined}
              className={`grid ${rowMotion} ${position >= COMPACT_ROWS ? "max-lg:hidden" : ""}`}
            >
              <div className="min-h-0 overflow-hidden">
                {/* The divider sits inside the clipped track, so it closes with a leaving row. */}
                <div
                  data-severity={event.severity}
                  className={`flex gap-3 px-3.5 py-2.5 ${position > 0 ? "border-t border-line" : ""} ${contentMotion}`}
                  style={
                    initial
                      ? { animationDelay: `${INITIAL_ROWS_START_MS + (INITIAL_SEQ - key) * INITIAL_ROWS_STAGGER_MS}ms` }
                      : undefined
                  }
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-panel font-mono text-[10px] font-semibold text-foreground"
                  >
                    {PLATFORM_MARKS[event.platform]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-xs text-muted">{event.platform}</span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                        {ageSeconds === 0 ? "now" : `${ageSeconds}s ago`}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-start justify-between gap-3">
                      <span className="text-sm leading-5">{event.text}</span>
                      <SeverityBadge severity={event.severity} />
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
