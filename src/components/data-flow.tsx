import { FlowSourceMark, FlowStage, type FlowEvent, type FlowNode } from "@/components/data-flow-stage";
import { CENTER, ORBIT } from "@/components/data-flow-geometry";
import { PausableMotion } from "@/components/pausable-motion";
import { Wordmark } from "@/components/wordmark";
import { SOURCE_PLATFORMS, sourceIds, type SourceId } from "@/lib/sources";
import { site } from "@/lib/site";

interface SourceEvent extends FlowEvent {
  /** Seconds after load that the packet first leaves its node. Set only on the looping ones. */
  delay?: number;
}

interface SourceDetail {
  caption: string;
  /** What a click sends, in turn. The ones with a delay also loop by themselves, two at most. */
  events: readonly SourceEvent[];
}

// Illustrative only. One entry per source: a new id in sourceIds fails the type check here until
// it has a caption and events, and then joins the constellation and the text alternative on its
// own. Every event is one its adapter on main reads (docs/providers), worded like the
// hero feed (feedEvents in live-event-feed.tsx) where the feed has the same event, so the hero
// tells one story. Resend mirrors Vercel across the orbit and their labels point at each other,
// so their delays sit a second apart.
const sourceDetails: Record<SourceId, SourceDetail> = {
  vercel: {
    caption: "Deploys · spend",
    events: [
      { label: "Deploy ready · acme-web", severity: "success", delay: 0.6 },
      { label: "Preview failed · acme-docs", severity: "danger", delay: 2.6 },
      { label: "Spend at 90% of budget", severity: "warning" },
    ],
  },
  github: {
    caption: "Billing · repos",
    events: [
      { label: "New fork of acme/api", severity: "success", delay: 0 },
      { label: "acme/cli hit 1,000 ★", severity: "success", delay: 2 },
      { label: "Spend at 75% of budget", severity: "warning" },
    ],
  },
  resend: {
    caption: "Emails · quota",
    events: [
      { label: "Emails at 75% of quota", severity: "warning", delay: 1.6 },
      { label: "Allowance reset", severity: "summary", delay: 3.6 },
    ],
  },
  stripe: {
    caption: "Payments · fees",
    events: [
      { label: "$49.00 paid · Pro", severity: "success", delay: 1.2 },
      { label: "Renewal failed", severity: "danger", delay: 3.2 },
      { label: "New Team subscription", severity: "success" },
    ],
  },
  supabase: {
    caption: "Usage · signups",
    events: [
      { label: "New signup · acme-app", severity: "success", delay: 0.3 },
      { label: "312 logins yesterday", severity: "summary", delay: 2.3 },
      { label: "New signup · acme-docs", severity: "success" },
    ],
  },
  digitalocean: {
    caption: "Deploys · usage",
    events: [
      { label: "App deploy live · acme-api", severity: "success" },
      { label: "Droplet power cycled · db-1", severity: "warning" },
    ],
  },
  posthog: {
    caption: "Signups · spend",
    events: [
      { label: "9 signups today · acme-app", severity: "summary" },
      { label: "Spend at 80% of budget", severity: "warning" },
    ],
  },
  polar: {
    caption: "Orders · fees",
    events: [
      { label: "Order paid · $29.00", severity: "success" },
      { label: "Refund issued · $9.00", severity: "warning" },
    ],
  },
  sentry: {
    caption: "Errors · releases",
    events: [
      { label: "New issue · acme-api", severity: "danger" },
      { label: "Release 1.4.0 out", severity: "success" },
    ],
  },
  railway: {
    caption: "Deploys · usage",
    events: [
      { label: "Deploy live · worker", severity: "success" },
      { label: "Deploy crashed · worker", severity: "danger" },
    ],
  },
  gitlab: {
    caption: "Pipelines · minutes",
    events: [
      { label: "Pipeline passed · acme/cli", severity: "success" },
      { label: "MR !42 merged", severity: "success" },
    ],
  },
};

// Rough stage-pixel extents for the parked-packet clearance below. A card with looping packets is
// about 138 by 41 (the caption sets the width, so GitLab's is 162), a label is 22 tall, and the
// dot's glow reaches about 8 px from its center. On main, e2e/data-flow.spec.ts measures the real
// boxes and fails if a parked packet touches a card or a label covers the center text.
const CARD_HALF = { x: 68, y: 21 } as const;
const DOT_REACH = 8;
const LABEL_HALF_HEIGHT = 11;
// On a mostly vertical line the next cards around the orbit sit 32 px lower than the node today.
// Its labels are clear of their row once the dot is that far below the node, plus half a card and
// half a label: 32 + 21 + 11.
const NEIGHBOR_ROW_CLEARANCE = 64;

/**
 * How far along its line a packet parks under reduced motion: the first point where it is clear of
 * its own card. A mostly horizontal line clears it sideways (the dot past the card's edge) or
 * vertically (the label below or above the card), whichever comes first; a mostly vertical line
 * goes on until its labels are below the neighboring cards' row. A packet a visitor sends starts
 * here too.
 */
function parkDistance(dx: number, dy: number, mostlyVertical: boolean): string {
  const length = Math.hypot(dx, dy);
  const along = (offset: number, component: number) => offset / (Math.abs(component) / length);
  const clearance = mostlyVertical
    ? along(NEIGHBOR_ROW_CLEARANCE, dy)
    : Math.min(along(CARD_HALF.x + DOT_REACH, dx), along(CARD_HALF.y + LABEL_HALF_HEIGHT, dy));
  return `${Math.ceil((clearance / length) * 100)}%`;
}

// The sources with looping packets, clockwise from the top. They are spread evenly around the
// orbit and every other source fills the slots between them, in sourceIds order, so the
// moving labels never bunch on one side.
const FEATURED: readonly SourceId[] = ["github", "vercel", "stripe", "supabase", "resend"];

function orbitOrder(): SourceId[] {
  const featuredSlots = new Map(
    FEATURED.map((id, index) => [Math.round((index * sourceIds.length) / FEATURED.length), id]),
  );
  const rest = sourceIds.filter((id) => !FEATURED.includes(id));
  const order: SourceId[] = [];
  for (let slot = 0; slot < sourceIds.length; slot++) {
    const id = featuredSlots.get(slot) ?? rest.shift();
    if (id === undefined) throw new Error(`No provider for orbit slot ${slot}`);
    order.push(id);
  }
  return order;
}

// Evenly spaced around the orbit, clockwise from the top. A line straight down from the top has no
// side facing the center and takes the right; its labels only appear once they are below the
// neighboring cards' row (the fade-in in globals.css). Under reduced motion a line's second packet
// parks beside its first: a mostly vertical line stacks toward the center, along itself, and a
// mostly horizontal line stacks up, nudged toward the center, so its dot clears its own card.
const nodes: readonly FlowNode[] = orbitOrder().map((id, slot) => {
  const angle = (slot / sourceIds.length) * 2 * Math.PI;
  const x = Math.round(CENTER.x + ORBIT.rx * Math.sin(angle));
  const y = Math.round(CENTER.y - ORBIT.ry * Math.cos(angle));
  const towardCenterIsDown = y < CENTER.y;
  const mostlyVertical = Math.abs(CENTER.x - x) < Math.abs(CENTER.y - y);
  const { caption, events } = sourceDetails[id];
  return {
    id,
    name: SOURCE_PLATFORMS[id],
    caption,
    platform: SOURCE_PLATFORMS[id],
    x,
    y,
    labelSide: x > CENTER.x ? "left" : "right",
    park: parkDistance(CENTER.x - x, CENTER.y - y, mostlyVertical),
    axis: mostlyVertical ? "vertical" : "horizontal",
    stack: mostlyVertical && towardCenterIsDown ? "down" : "up",
    ambient: events.flatMap(({ label, severity, delay }) => (delay === undefined ? [] : [{ label, severity, delay }])),
    events: events.map(({ label, severity }) => ({ label, severity })),
  };
});

const sourceNames = new Intl.ListFormat("en-US", { type: "conjunction" }).format(nodes.map((node) => node.name));
const pictureLabel = `Events from ${sourceNames} flow into one ${site.name} timeline.`;

// Matches the hero feed's opening counter: EVENTS_TODAY_BEFORE_FEED plus INITIAL_SEQ in
// live-event-feed.tsx. A client module's constants are not values in a server component, so it is
// restated here.
const ILLUSTRATIVE_EVENT_COUNT = 1287;

// Below sm the scaled stage would shrink its labels past reading, so phones get the same story as
// one readable picture: every source, a stream, and the timeline they land on. It moves in CSS
// alone (.compact-* in globals.css), on one beat of COMPACT_BEAT_S: each beat a source card
// lights, a dot runs down the stream, and as it lands the center rings and counts one more event.
// Every delay below is a whole number of beats from load, so the parts stay in step, and the
// Pause control holds them all at once.
const COMPACT_BEAT_S = 1.2;
// A dot leaves the stream this long after its card lights, and lands this long after that. The
// .compact-dot keyframes run over three beats and encode the same two times as percentages.
const COMPACT_DOT_LEAVE_S = 0.4;
const COMPACT_DOT_TRAVEL_S = 1;
const COMPACT_LAND_S = COMPACT_DOT_LEAVE_S + COMPACT_DOT_TRAVEL_S;
const compactDots = ["bg-success text-success", "bg-warning text-warning", "bg-danger text-danger"] as const;
// The hub counts one event a beat for this many beats (20 minutes), then holds its last number.
// CSS cannot loop a count without it jumping back, and nobody watches a placeholder that long.
const COMPACT_COUNT_STEPS = 1000;

const eventCount = new Intl.NumberFormat("en-US");

function CompactFlow() {
  return (
    <PausableMotion className="sm:hidden">
      <div role="img" aria-label={pictureLabel} className="flex flex-col items-center gap-4">
        <ul className="grid w-full grid-cols-2 gap-2">
          {nodes.map((node, slot) => (
            <li
              key={node.id}
              className="compact-source flex items-center gap-2 rounded-xl border border-line-strong bg-panel px-3 py-2"
              style={{
                animationDuration: `${nodes.length * COMPACT_BEAT_S}s`,
                animationDelay: `${slot * COMPACT_BEAT_S}s`,
              }}
            >
              <FlowSourceMark platform={node.platform} />
              <div className="min-w-0 leading-none">
                <p className="text-[13px] font-medium">{node.name}</p>
                <p className="mt-1 font-mono text-[10px] leading-4 text-muted">{node.caption}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="relative h-14 w-4">
          <svg width="16" height="56" viewBox="0 0 16 56" fill="none" className="stroke-accent">
            <path d="M8 0v54M2 48l6 6 6-6" strokeWidth="1.5" />
          </svg>
          {compactDots.map((color, index) => (
            <span
              key={color}
              className={`compact-dot absolute left-1 top-0 size-2 rounded-full ${color}`}
              style={{
                animationDuration: `${compactDots.length * COMPACT_BEAT_S}s`,
                animationDelay: `${index * COMPACT_BEAT_S}s`,
              }}
            />
          ))}
        </div>
        <div className="flow-core relative flex size-[150px] items-center justify-center rounded-full border border-line-strong bg-panel">
          <span
            className="compact-ring"
            style={{ animationDuration: `${COMPACT_BEAT_S}s`, animationDelay: `${COMPACT_LAND_S}s` }}
          />
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Wordmark loading="lazy" />
            <p className="font-mono text-xs tabular-nums text-foreground">
              <span
                className="compact-count"
                data-value={`${eventCount.format(ILLUSTRATIVE_EVENT_COUNT)} events`}
                style={{
                  "--count-to": ILLUSTRATIVE_EVENT_COUNT,
                  "--count-steps": COMPACT_COUNT_STEPS,
                  animationDuration: `${COMPACT_COUNT_STEPS * COMPACT_BEAT_S}s`,
                  animationDelay: `${COMPACT_LAND_S}s`,
                  animationTimingFunction: `steps(${COMPACT_COUNT_STEPS}, jump-start)`,
                }}
              />
            </p>
            <p className="font-mono text-[10px] text-muted">Illustrative</p>
          </div>
        </div>
      </div>
    </PausableMotion>
  );
}

/**
 * Every live source feeding one timeline: an illustrative constellation beside the hero heading.
 * Each layout carries the same text alternative: the phone picture as an image, the interactive
 * stage as a group around its source buttons.
 */
export function DataFlow() {
  return (
    <div>
      <CompactFlow />
      <FlowStage nodes={nodes} initialCount={ILLUSTRATIVE_EVENT_COUNT} label={pictureLabel} />
    </div>
  );
}
