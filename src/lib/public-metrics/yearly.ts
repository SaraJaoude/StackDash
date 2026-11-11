import type { ProviderId } from "@/lib/adapters/types";
import { formatUtcDate } from "@/lib/format";
import { PROVIDER_NAMES } from "@/lib/providers";

import { UNAVAILABLE_LABELS } from "./display";
import { publicMetricDefinition, type PublicMetricId } from "./definitions";
import { computePublicMetrics, historyStart, STALE_AFTER_MS, type PublicMetricStore, type SourceAccount } from "./engine";

/*
 * The yearly stack summary (#151): a card of what a workspace did in a calendar year, computed by
 * the public metric engine (#148) from stored snapshots and events only, across every included
 * account of the workspace. Private: nothing here is published, and the card is shown to members
 * only until one of them downloads and posts it. A past year's card covers the whole year; the
 * current year's card is always there too, as the year to date, labeled "2026 so far" (decision
 * on issue #151), so a workspace can see and share its year at any time.
 *
 * Only change and count metrics fit a year, because only they take a window (`from` in engine.ts):
 * deployments, stars gained, and signups. The window starts on 1 January, or where the stored
 * history starts when that is later, and the card then says "since" that day, so a workspace
 * connected in August shows August to December instead of "not enough history". Emails and GitHub
 * Actions minutes are monthly totals in the engine, with no yearly formula, so they are left off
 * (decision on issue #151). No money, ever.
 *
 * A figure whose provider has not synced within the engine's `STALE_AFTER_MS` is counted up to its
 * oldest last sync instead, and says "counted up to" that day (#267): a count over the year is
 * still true up to there, where a public current value is not.
 *
 * The year in review (#262) turns the card into four slides, each downloadable as an image: the
 * busiest day, the longest run of successful deployments, the most active provider, and the totals
 * above. The figures safe to show were decided before coding:
 * https://github.com/eddiejaoude/DevMacro/issues/262#issuecomment-6790096177. No spend, no revenue,
 * no account names, no repository names: a provider is named by its product name only, and the
 * event counts leave out payments, because a payment count hints at revenue.
 *
 * Pure apart from the injected store, so it is unit tested against the in-memory store.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The figures, with how a post words one and many of each. */
export const YEARLY_METRICS = [
  { metricId: "vercel-deployments-30d", label: "Deployments shipped", nouns: ["deployment shipped", "deployments shipped"] },
  { metricId: "github-stars-gained-30d", label: "Stars gained", nouns: ["star gained", "stars gained"] },
  { metricId: "supabase-signups-30d", label: "Signups", nouns: ["signup", "signups"] },
] as const satisfies readonly Readonly<{ metricId: PublicMetricId; label: string; nouns: readonly [string, string] }>[];

/** A year has a card once it has started: in full once it has ended, as the year to date before. */
export function hasYearStarted(year: number, now: Date): boolean {
  return now.getTime() > Date.UTC(year, 0, 1);
}

/** True once `year` has ended at `now`, so its card is the whole year rather than the year to date. */
export function isYearComplete(year: number, now: Date): boolean {
  return now.getTime() >= Date.UTC(year + 1, 0, 1);
}

/** "2025" for a year that has ended at `now`, "2026 so far" for the year to date. */
export function yearLabel(year: number, now: Date): string {
  return isYearComplete(year, now) ? String(year) : `${year} so far`;
}

/** The note under the year to date: when the slides start to cover the whole year, as an ISO date. */
export function yearToDateNote(year: number): string {
  const end = formatUtcDate(new Date(Date.UTC(year + 1, 0, 1)));
  return `${year} is not over yet. These slides count up to today and cover the whole year from ${end}.`;
}

/** The newest year with a card at `now`: this year to date (last year only at midnight on 1 January). */
export function latestCardYear(now: Date): number {
  const year = now.getUTCFullYear();
  return hasYearStarted(year, now) ? year : year - 1;
}

/** The year in a URL segment when it has started at `now`, else null (malformed or in the future). */
export function parseCardYear(segment: string, now: Date): number | null {
  if (!/^[1-9][0-9]{3}$/.test(segment)) return null;
  const year = Number(segment);
  return hasYearStarted(year, now) ? year : null;
}

export type YearStat =
  | Readonly<{
      label: string;
      status: "available";
      value: number;
      /** The window's start when it is later than 1 January, else null. */
      since: Date | null;
      /** The provider's oldest last sync when it is more than `STALE_AFTER_MS` old, else null. */
      countedUpTo: Date | null;
      simulated: boolean;
    }>
  | Readonly<{ label: string; status: "unavailable"; text: string }>;

export type YearSummary = Readonly<{
  year: number;
  /** 1 January, 00:00 UTC. */
  start: Date;
  /** The end of the year, or `now` when the year is still running. */
  asOf: Date;
  stats: readonly YearStat[];
  /** Distinct providers with an included account connected before `asOf`. */
  providers: number;
  /** Any figure, including the provider count, rests on simulated data (#131). */
  simulated: boolean;
}>;

/** Reads the accounts once for every figure of the review instead of once per call into the engine. */
function withSharedAccounts(store: YearReviewStore): YearReviewStore {
  const accounts = store.accounts();
  return {
    accounts: () => accounts,
    snapshots: (query) => store.snapshots(query),
    earliestSnapshotDate: (query) => store.earliestSnapshotDate(query),
    countEvents: (query) => store.countEvents(query),
    earliestEvent: (query) => store.earliestEvent(query),
    recentEvents: (query) => store.recentEvents(query),
    eventActivity: (query) => store.eventActivity(query),
    longestRun: (query) => store.longestRun(query),
  };
}

/**
 * Where a stale provider's figure is counted up to: the oldest last sync of its accounts, when that
 * is more than `STALE_AFTER_MS` before `asOf`. Null when the data is fresh, and when an account has
 * never synced, which the engine reports as it is.
 */
function staleSyncedUpTo(accounts: readonly SourceAccount[], asOf: Date): Date | null {
  const synced = accounts.flatMap((account) => (account.lastSyncedAt === null ? [] : [account.lastSyncedAt.getTime()]));
  if (synced.length === 0 || synced.length < accounts.length) return null;
  const oldest = Math.min(...synced);
  return asOf.getTime() - oldest > STALE_AFTER_MS ? new Date(oldest) : null;
}

/**
 * The totals of the year. Reads `store.accounts()` once per metric, so a store that reads the
 * database shares one read (`computeYearReview` does).
 */
export async function computeYearSummary(store: PublicMetricStore, year: number, now: Date): Promise<YearSummary> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const asOf = new Date(Math.min(now.getTime(), end.getTime()));
  if (asOf.getTime() <= start.getTime()) throw new RangeError(`The year ${year} has not started at ${now.toISOString()}`);

  const [accounts, starts] = await Promise.all([
    store.accounts(),
    Promise.all(YEARLY_METRICS.map((metric) => historyStart(store, metric.metricId))),
  ]);
  const windows = YEARLY_METRICS.map((metric, index) => {
    const historyFrom = starts[index] ?? null;
    const from = historyFrom !== null && historyFrom.getTime() > start.getTime() ? historyFrom : start;
    const { provider } = publicMetricDefinition(metric.metricId);
    const countedUpTo = staleSyncedUpTo(
      accounts.filter((account) => account.provider === provider),
      asOf,
    );
    const metricAsOf = countedUpTo ?? asOf;
    return { ...metric, from, asOf: metricAsOf, countedUpTo, inYear: from.getTime() < metricAsOf.getTime() };
  });
  const counted = windows.filter((window) => window.inYear);
  const computed = await computePublicMetrics(
    store,
    counted.map((window) => ({ metricId: window.metricId, asOf: window.asOf, from: window.from })),
  );

  const stats = windows.map((window): YearStat => {
    if (!window.inYear) return { label: window.label, status: "unavailable", text: `No data in ${year}` };
    const result = computed[counted.indexOf(window)]?.result;
    if (result === undefined) throw new Error("computePublicMetrics returned fewer results than requested");
    if (result.status === "unavailable") return { label: window.label, status: "unavailable", text: UNAVAILABLE_LABELS[result.reason] };
    // A start within the first day of the year is still the whole year.
    const since = window.from.getTime() - start.getTime() >= DAY_MS ? window.from : null;
    return {
      label: window.label,
      status: "available",
      value: result.value,
      since,
      countedUpTo: window.countedUpTo,
      simulated: result.simulated,
    };
  });

  const connected = accounts.filter((account) => account.connectionCreatedAt.getTime() < asOf.getTime());
  const providers = new Set(connected.map((account) => account.provider)).size;
  const simulated =
    connected.some((account) => account.simulated) || stats.some((stat) => stat.status === "available" && stat.simulated);
  return { year, start, asOf, stats, providers, simulated };
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** One figure as the card and the page show it; dates are UTC days, `YYYY-MM-DD`. */
export type YearFigure = Readonly<{ label: string; value: string; since: string | null; countedUpTo: string | null }>;

/** Every figure of the summary, the engine's metrics first, then the provider count. */
export function yearFigures(summary: YearSummary): YearFigure[] {
  return [
    ...summary.stats.map((stat) =>
      stat.status === "available"
        ? {
            label: stat.label,
            value: NUMBER_FORMAT.format(stat.value),
            since: stat.since === null ? null : formatUtcDate(stat.since),
            countedUpTo: stat.countedUpTo === null ? null : formatUtcDate(stat.countedUpTo),
          }
        : { label: stat.label, value: stat.text, since: null, countedUpTo: null },
    ),
    { label: "Providers connected", value: NUMBER_FORMAT.format(summary.providers), since: null, countedUpTo: null },
  ];
}

/** "since 2026-08-07, counted up to 2026-11-07", either part alone, or null with neither. */
export function yearFigureNote(figure: Pick<YearFigure, "since" | "countedUpTo">): string | null {
  const parts = [
    ...(figure.since === null ? [] : [`since ${figure.since}`]),
    ...(figure.countedUpTo === null ? [] : [`counted up to ${figure.countedUpTo}`]),
  ];
  return parts.length === 0 ? null : parts.join(", ");
}

/** "2025-01-01 to 2025-12-31", or to today while the year runs. */
export function yearPeriod(summary: YearSummary): string {
  return `${formatUtcDate(summary.start)} to ${formatUtcDate(new Date(summary.asOf.getTime() - 1))}`;
}

/** "2025" for a whole year, "2026 so far" for the year to date. */
export function yearSummaryLabel(summary: YearSummary): string {
  return yearLabel(summary.year, summary.asOf);
}

export function yearProvenance(summary: YearSummary): string {
  return summary.simulated ? "Simulated data, not verified" : "Counted by DevMacro from stored data";
}

/** Alt text for the yearly card: every figure in words. */
export function yearCardAltText(summary: YearSummary): string {
  const figures = yearFigures(summary)
    .map((figure) => {
      const note = yearFigureNote(figure);
      return `${figure.label}: ${figure.value}${note === null ? "" : `, ${note}`}.`;
    })
    .join(" ");
  return `DevMacro card: your stack in ${yearSummaryLabel(summary)}, ${yearPeriod(summary)}. ${figures} ${yearProvenance(summary)}.`;
}

/** The prefilled post for "Share to X": the figures that have a number. */
export function yearShareText(summary: YearSummary): string {
  const counted = summary.stats.flatMap((stat) => {
    if (stat.status === "unavailable") return [];
    const nouns = YEARLY_METRICS.find((metric) => metric.label === stat.label)?.nouns;
    if (nouns === undefined) throw new Error(`No wording for the yearly figure ${stat.label}`);
    return [`${NUMBER_FORMAT.format(stat.value)} ${nouns[stat.value === 1 ? 0 : 1]}`];
  });
  const figures = counted.length === 0 ? "" : `: ${counted.join(", ")}`;
  return `My stack in ${yearSummaryLabel(summary)} on DevMacro${figures}.${summary.simulated ? " Simulated data." : ""}`;
}

// ── The year in review (#262) ────────────────────────────────────────────────────

/**
 * Event types the review never counts: payments, failed payments, and refunds, because a payment
 * count hints at revenue (decision on #262). `yearly.test.ts` proves every id is one an adapter
 * declares, and that every payment or refund event a revenue provider declares is listed here.
 */
export const PAYMENT_EVENT_TYPE_IDS = [
  "polar.order.paid",
  "polar.refund.succeeded",
  "stripe.charge.failed",
  "stripe.charge.refunded",
  "stripe.charge.succeeded",
] as const;

/** The run counts the deployments "Deployments shipped" counts: the streak metric's two types. */
const RUN_METRIC_ID = "vercel-deployment-streak" satisfies PublicMetricId;

export type DayCount = Readonly<{ /** Europe/London calendar day, `YYYY-MM-DD`. */ day: string; events: number }>;
export type ProviderCount = Readonly<{ provider: ProviderId; events: number }>;

/** Events of a window counted per Europe/London calendar day (days with none left out) and per provider. */
export type EventActivity = Readonly<{ days: readonly DayCount[]; providers: readonly ProviderCount[] }>;

/** The reads the year in review adds to the engine's, scoped to the accounts passed in like those. */
export interface YearReviewStore extends PublicMetricStore {
  /** Events not of `excludedTypeIds` with `from <= occurred_at < to`, per London day and per provider. */
  eventActivity(
    query: Readonly<{ accountIds: readonly string[]; excludedTypeIds: readonly string[]; from: Date; to: Date }>,
  ): Promise<EventActivity>;
  /**
   * The most `successTypeId` events in a row with `from <= occurred_at < to`, in occurred_at order,
   * with no `failureTypeId` event between them. A failure that shares its instant with a success is
   * taken first, so a tie never lengthens a run. 0 with no success.
   */
  longestRun(
    query: Readonly<{ accountIds: readonly string[]; successTypeId: string; failureTypeId: string; from: Date; to: Date }>,
  ): Promise<number>;
}

export type YearRun = Readonly<{ status: "available"; deployments: number }> | Readonly<{ status: "not_connected" }>;

/** The provider with the most events, and the providers with as many, by name. */
export type TopProvider = Readonly<{ provider: ProviderId; events: number; tiedWith: readonly ProviderId[] }>;

export type YearReview = Readonly<{
  summary: YearSummary;
  busiestDay: DayCount | null;
  longestRun: YearRun;
  topProvider: TopProvider | null;
  /** When the workspace's first included account was connected, when that is after the first day of the year. */
  firstConnectedAt: Date | null;
}>;

/** The day with the most events. On a tie, the earliest of those days: the first day the year reached that count. */
export function busiestDay(days: readonly DayCount[]): DayCount | null {
  let busiest: DayCount | null = null;
  for (const day of days) {
    if (day.events <= 0) continue;
    if (busiest === null || day.events > busiest.events || (day.events === busiest.events && day.day < busiest.day)) busiest = day;
  }
  return busiest;
}

/** The provider with the most events. On a tie, the first by name from A to Z, with the others in `tiedWith`. */
export function mostActiveProvider(providers: readonly ProviderCount[]): TopProvider | null {
  const most = Math.max(0, ...providers.map((entry) => entry.events));
  if (most === 0) return null;
  const [first, ...rest] = providers
    .filter((entry) => entry.events === most)
    .map((entry) => entry.provider)
    .sort((a, b) => PROVIDER_NAMES[a].localeCompare(PROVIDER_NAMES[b], "en-US"));
  return first === undefined ? null : { provider: first, events: most, tiedWith: rest };
}

function runTypes(): Readonly<{ provider: ProviderId; successTypeId: string; failureTypeId: string }> {
  const { provider, source } = publicMetricDefinition(RUN_METRIC_ID);
  if (source.type !== "event_streak") throw new Error(`${RUN_METRIC_ID} is not a streak of events`);
  return { provider, successTypeId: source.successTypeId, failureTypeId: source.failureTypeId };
}

/**
 * The four slides' figures for `year` at `now`, from stored data only: events up to the end of the
 * year or `now`, of the workspace's included accounts. One accounts read; the rest run in parallel.
 */
export async function computeYearReview(source: YearReviewStore, year: number, now: Date): Promise<YearReview> {
  const store = withSharedAccounts(source);
  const start = new Date(Date.UTC(year, 0, 1));
  const asOf = new Date(Math.min(now.getTime(), Date.UTC(year + 1, 0, 1)));
  const accounts = await store.accounts();
  const run = runTypes();
  const runAccountIds = accounts.filter((account) => account.provider === run.provider).map((account) => account.accountId);

  const [summary, activity, longest] = await Promise.all([
    computeYearSummary(store, year, now),
    store.eventActivity({
      accountIds: accounts.map((account) => account.accountId),
      excludedTypeIds: PAYMENT_EVENT_TYPE_IDS,
      from: start,
      to: asOf,
    }),
    runAccountIds.length === 0
      ? null
      : store.longestRun({ accountIds: runAccountIds, successTypeId: run.successTypeId, failureTypeId: run.failureTypeId, from: start, to: asOf }),
  ]);

  const firstConnected = Math.min(...accounts.map((account) => account.connectionCreatedAt.getTime()));
  return {
    summary,
    busiestDay: busiestDay(activity.days),
    longestRun: longest === null ? { status: "not_connected" } : { status: "available", deployments: longest },
    topProvider: mostActiveProvider(activity.providers),
    // A connection within the first day of the year still covers the whole year, as `since` does.
    firstConnectedAt: firstConnected - start.getTime() >= DAY_MS && firstConnected < asOf.getTime() ? new Date(firstConnected) : null,
  };
}

/** Slide order, and the address and file name each slide's image goes by. */
export const YEAR_SLIDE_IDS = ["busiest-day", "deployment-run", "top-provider", "totals"] as const;
export type YearSlideId = (typeof YEAR_SLIDE_IDS)[number];

export type YearSlide =
  | Readonly<{ id: Exclude<YearSlideId, "totals">; title: string; value: string; detail: string }>
  | Readonly<{ id: "totals"; title: string; figures: readonly YearFigure[] }>;

// The busiest day is a calendar date already, so its weekday is read in UTC, never shifted.
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const AND_LIST = new Intl.ListFormat("en-US", { type: "conjunction" });

function counted(value: number, one: string, many: string): string {
  return `${NUMBER_FORMAT.format(value)} ${value === 1 ? one : many}`;
}

/** The four slides in order, every value in words or digits, never a dash. */
export function yearSlides(review: YearReview): YearSlide[] {
  const label = yearSummaryLabel(review.summary);
  const runProvider = PROVIDER_NAMES[runTypes().provider];
  const { busiestDay: day, longestRun: run, topProvider: top } = review;

  const busiest: YearSlide =
    day === null
      ? { id: "busiest-day", title: "Busiest day", value: "No events", detail: `Your connected providers sent no events in ${label}.` }
      : {
          id: "busiest-day",
          title: "Busiest day",
          value: `${WEEKDAY.format(new Date(`${day.day}T00:00:00Z`))}, ${day.day}`,
          detail: `${counted(day.events, "event", "events")} on your timeline that day, not counting payments.`,
        };

  const runTitle = "Longest run of successful deployments";
  const longest: YearSlide =
    run.status === "not_connected"
      ? { id: "deployment-run", title: runTitle, value: UNAVAILABLE_LABELS.not_connected, detail: `Connect ${runProvider} to count your deployments.` }
      : run.deployments === 0
        ? { id: "deployment-run", title: runTitle, value: "No successful deployments", detail: `No ${runProvider} deployment succeeded in ${label}.` }
        : {
            id: "deployment-run",
            title: runTitle,
            value: `${NUMBER_FORMAT.format(run.deployments)} in a row`,
            detail: `${runProvider} deployments that succeeded one after another, with no failed deployment between them.`,
          };

  const providerTitle = "Most active provider";
  const provider: YearSlide =
    top === null
      ? { id: "top-provider", title: providerTitle, value: "No provider activity", detail: `No connected provider sent events in ${label}.` }
      : {
          id: "top-provider",
          title: providerTitle,
          value: PROVIDER_NAMES[top.provider],
          detail:
            top.tiedWith.length === 0
              ? `${counted(top.events, "event", "events")} on your timeline, more than any other provider, not counting payments.`
              : `${counted(top.events, "event", "events")} on your timeline, as many as ${AND_LIST.format(top.tiedWith.map((id) => PROVIDER_NAMES[id]))}, not counting payments. On a tie the first by name is shown.`,
        };

  return [busiest, longest, provider, { id: "totals", title: "Totals", figures: yearFigures(review.summary) }];
}

/** Alt text for a slide's image: the slide in words. The totals slide is the yearly card. */
export function yearSlideAltText(review: YearReview, slide: YearSlide): string {
  if (slide.id === "totals") return yearCardAltText(review.summary);
  const { summary } = review;
  return `DevMacro slide for your stack in ${yearSummaryLabel(summary)}, ${yearPeriod(summary)}. ${slide.title}: ${slide.value}. ${slide.detail} ${yearProvenance(summary)}.`;
}

/** The prefilled post for "Share to X" of one slide; a slide with nothing to count names the year only. */
export function yearSlideShareText(review: YearReview, slide: YearSlide): string {
  const { summary, busiestDay: day, longestRun: run, topProvider: top } = review;
  if (slide.id === "totals") return yearShareText(summary);
  const label = yearSummaryLabel(summary);
  const simulated = summary.simulated ? " Simulated data." : "";
  if (slide.id === "busiest-day" && day !== null) {
    return `My busiest day of ${label} on DevMacro: ${counted(day.events, "event", "events")} on ${day.day}.${simulated}`;
  }
  if (slide.id === "deployment-run" && run.status === "available" && run.deployments > 0) {
    return `My longest run of successful deployments in ${label} on DevMacro: ${NUMBER_FORMAT.format(run.deployments)} in a row.${simulated}`;
  }
  if (slide.id === "top-provider" && top !== null) {
    return `My most active provider in ${label} on DevMacro: ${PROVIDER_NAMES[top.provider]}.${simulated}`;
  }
  return `My stack in ${label} on DevMacro.${simulated}`;
}

/** A slide's image under the year page. The totals keep the yearly card's address, `card.png`. */
export function yearSlideFile(id: YearSlideId): string {
  return id === "totals" ? "card.png" : `${id}.png`;
}

/** The slide a URL segment names, or null. */
export function parseYearSlideFile(segment: string): YearSlideId | null {
  return YEAR_SLIDE_IDS.find((id) => yearSlideFile(id) === segment) ?? null;
}

/** "devmacro-2025-busiest-day.png", "devmacro-2026-so-far.png" for the totals of the year to date. */
export function yearSlideDownloadName(summary: YearSummary, id: YearSlideId): string {
  const base = isYearComplete(summary.year, summary.asOf) ? `devmacro-${summary.year}` : `devmacro-${summary.year}-so-far`;
  return id === "totals" ? `${base}.png` : `${base}-${id}.png`;
}

/** Why the slides may cover part of the year: the first provider was connected after it began. Null otherwise. */
export function yearPartialNote(review: YearReview): string | null {
  if (review.firstConnectedAt === null) return null;
  return `Your first provider was connected on ${formatUtcDate(review.firstConnectedAt)}, so these slides may cover only part of ${review.summary.year}.`;
}
