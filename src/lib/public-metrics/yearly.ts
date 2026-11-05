import { formatUtcDate } from "@/lib/format";

import { UNAVAILABLE_LABELS } from "./display";
import type { PublicMetricId } from "./definitions";
import { computePublicMetrics, historyStart, type PublicMetricStore } from "./engine";

/*
 * The yearly stack summary (#151): a once-a-year card of what a workspace did in a calendar year,
 * computed by the public metric engine (#148) from stored snapshots and events only, across every
 * included account of the workspace. Private: nothing here is published, and the card is shown to
 * members only until one of them downloads and posts it.
 *
 * Only change and count metrics fit a year, because only they take a window (`from` in engine.ts):
 * deployments, stars gained, and signups. The window starts on 1 January, or where the stored
 * history starts when that is later, and the card then says "since" that day, so a workspace
 * connected in August shows August to December instead of "not enough history". Emails and GitHub
 * Actions minutes are monthly totals in the engine, with no yearly formula, so they are left off
 * (decision on issue #151). No money, ever.
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

/** 1 December of `year`, 00:00 UTC (also 00:00 in London, which is on GMT in December). */
export function yearCardOpensAt(year: number): Date {
  return new Date(Date.UTC(year, 11, 1));
}

/** The card of `year` opens on 1 December of that year and stays open afterwards. */
export function isYearCardOpen(year: number, now: Date): boolean {
  return now.getTime() >= yearCardOpensAt(year).getTime();
}

/** The newest year whose card is open at `now`: this year from 1 December, else last year. */
export function latestOpenYear(now: Date): number {
  const year = now.getUTCFullYear();
  return isYearCardOpen(year, now) ? year : year - 1;
}

/** The year in a URL segment when its card is open at `now`, else null (malformed or too early). */
export function parseCardYear(segment: string, now: Date): number | null {
  if (!/^[1-9][0-9]{3}$/.test(segment)) return null;
  const year = Number(segment);
  return isYearCardOpen(year, now) ? year : null;
}

export type YearStat =
  | Readonly<{
      label: string;
      status: "available";
      value: number;
      /** The window's start when it is later than 1 January, else null. */
      since: Date | null;
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

/** Reads the accounts once for every metric below instead of once per call into the engine. */
function withSharedAccounts(store: PublicMetricStore): PublicMetricStore {
  const accounts = store.accounts();
  return {
    accounts: () => accounts,
    snapshots: (query) => store.snapshots(query),
    earliestSnapshotDate: (query) => store.earliestSnapshotDate(query),
    countEvents: (query) => store.countEvents(query),
    earliestEvent: (query) => store.earliestEvent(query),
    recentEvents: (query) => store.recentEvents(query),
  };
}

export async function computeYearSummary(source: PublicMetricStore, year: number, now: Date): Promise<YearSummary> {
  const store = withSharedAccounts(source);
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
    return { ...metric, from, inYear: from.getTime() < asOf.getTime() };
  });
  const counted = windows.filter((window) => window.inYear);
  const computed = await computePublicMetrics(
    store,
    counted.map((window) => ({ metricId: window.metricId, asOf, from: window.from })),
  );

  const stats = windows.map((window): YearStat => {
    if (!window.inYear) return { label: window.label, status: "unavailable", text: `No data in ${year}` };
    const result = computed[counted.indexOf(window)]?.result;
    if (result === undefined) throw new Error("computePublicMetrics returned fewer results than requested");
    if (result.status === "unavailable") return { label: window.label, status: "unavailable", text: UNAVAILABLE_LABELS[result.reason] };
    // A start within the first day of the year is still the whole year.
    const since = window.from.getTime() - start.getTime() >= DAY_MS ? window.from : null;
    return { label: window.label, status: "available", value: result.value, since, simulated: result.simulated };
  });

  const connected = accounts.filter((account) => account.connectionCreatedAt.getTime() < asOf.getTime());
  const providers = new Set(connected.map((account) => account.provider)).size;
  const simulated =
    connected.some((account) => account.simulated) || stats.some((stat) => stat.status === "available" && stat.simulated);
  return { year, start, asOf, stats, providers, simulated };
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** One figure as the card and the page show it. */
export type YearFigure = Readonly<{ label: string; value: string; note: string | null }>;

/** Every figure of the summary, the engine's metrics first, then the provider count. */
export function yearFigures(summary: YearSummary): YearFigure[] {
  return [
    ...summary.stats.map((stat) =>
      stat.status === "available"
        ? { label: stat.label, value: NUMBER_FORMAT.format(stat.value), note: stat.since === null ? null : `since ${formatUtcDate(stat.since)}` }
        : { label: stat.label, value: stat.text, note: null },
    ),
    { label: "Providers connected", value: NUMBER_FORMAT.format(summary.providers), note: null },
  ];
}

/** "2025-01-01 to 2025-12-31", or to today while the year runs. */
export function yearPeriod(summary: YearSummary): string {
  return `${formatUtcDate(summary.start)} to ${formatUtcDate(new Date(summary.asOf.getTime() - 1))}`;
}

export function yearProvenance(summary: YearSummary): string {
  return summary.simulated ? "Simulated data, not verified" : "Counted by DevMacro from stored data";
}

/** Alt text for the yearly card: every figure in words. */
export function yearCardAltText(summary: YearSummary): string {
  const figures = yearFigures(summary)
    .map((figure) => `${figure.label}: ${figure.value}${figure.note === null ? "" : `, ${figure.note}`}.`)
    .join(" ");
  return `DevMacro card: your stack in ${summary.year}, ${yearPeriod(summary)}. ${figures} ${yearProvenance(summary)}.`;
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
  return `My stack in ${summary.year} on DevMacro${figures}.${summary.simulated ? " Simulated data." : ""}`;
}
