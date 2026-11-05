/**
 * Pure reductions for the dashboard's headline strip (#173): revenue against spend, signups, cost
 * per signup, and deploys over one common UTC window, each against the same days of the window
 * before. No I/O and no clock: the caller passes `now`. Kept apart from the billing period
 * reductions in `aggregate.ts`, because this strip deliberately ignores each provider's own period.
 *
 * Rules decided here, once:
 * - A window is the UTC calendar week (Monday first, ISO 8601) or month, to date. The previous
 *   window covers the same number of days from its own start, cut at its last day, so a part week
 *   is never compared with a whole one.
 * - Money comes from the daily snapshots of running billing period totals. A day's amount is the
 *   change in a running total since the previous reading of the same period; the first reading of
 *   a period counts everything since the period started. A change that spans a window edge cannot
 *   be split, so it makes its connection unavailable for that window instead of counting a part.
 * - A connection is available for a figure in a window only when every series it reports covers
 *   every day of the window up to the last required day (yesterday for the current window, since
 *   today is still running). Otherwise it is named unavailable and none of its amounts count.
 * - Money is grouped by currency and never converted. Verified and estimated amounts stay apart,
 *   in revenue minus spend and in cost per signup too.
 * - Signups and deploys are counts of synced events. A connection counts in a window when it had
 *   reported by the window's first day and has synced since the start of the last required day.
 * - A comparison needs every connection behind the current figure to be available in the previous
 *   window as well, and the previous figure is taken over those same connections.
 */
import { isSimulatedConnection } from "@/lib/adapters/simulated/marker";
import { formatMoney, formatQuantity } from "@/lib/format";
import { divideMinorUnits } from "@/lib/money";
import { providerName } from "@/lib/providers";

import { dropSupersededBreakdowns, isEstimated, type ConnectionInput, type SnapshotInput } from "./aggregate";
import { compareValues, type TrendComparison } from "./trends";

export const HEADLINE_WINDOW_KINDS = ["week", "month"] as const;
export type HeadlineWindowKind = (typeof HEADLINE_WINDOW_KINDS)[number];

const DAY_MS = 86_400_000;

/** UTC dates, `YYYY-MM-DD`, both ends inclusive. */
export type DateRange = Readonly<{ start: string; end: string }>;

export type HeadlineWindows = Readonly<{
  kind: HeadlineWindowKind;
  current: DateRange;
  previous: DateRange;
}>;

/** A window plus the last day every source must have reported for it to be complete. */
type WindowSpec = DateRange & Readonly<{ requiredEnd: string }>;

/**
 * Event types counted as signups and as deploys, each with its outcome. The provider is the type
 * id's prefix. A provider that adds a signup or deploy event type lists it here.
 */
export const SIGNUP_EVENT_TYPES: readonly string[] = ["fake.signup", "supabase.auth.signup"];
export const DEPLOY_EVENT_TYPES: Readonly<Record<string, "succeeded" | "failed">> = {
  "fake.deploy.succeeded": "succeeded",
  "vercel.deployment.succeeded": "succeeded",
  "vercel.deployment.failed": "failed",
};
/** Every event type the strip counts, for the count query. */
export const HEADLINE_EVENT_TYPES: readonly string[] = [...SIGNUP_EVENT_TYPES, ...Object.keys(DEPLOY_EVENT_TYPES)];

/** Providers whose connections can report revenue even before their first revenue reading. */
const REVENUE_PROVIDERS: readonly string[] = ["stripe"];

/** Events of one type from one connection within one window. */
export type EventCount = Readonly<{ connection_id: string; type_id: string; events: number }>;

function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function dayStart(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function addDays(date: string, days: number): string {
  return isoDate(dayStart(date) + days * DAY_MS);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** The current window to date and the same days of the window before it, in UTC. */
export function headlineWindows(kind: HeadlineWindowKind, now: Date): HeadlineWindows {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (kind === "week") {
    const sinceMonday = (now.getUTCDay() + 6) % 7;
    const start = today - sinceMonday * DAY_MS;
    const previousStart = start - 7 * DAY_MS;
    return {
      kind,
      current: { start: isoDate(start), end: isoDate(today) },
      previous: { start: isoDate(previousStart), end: isoDate(previousStart + sinceMonday * DAY_MS) },
    };
  }
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const previousStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  return {
    kind,
    current: { start: isoDate(start), end: isoDate(today) },
    // A shorter month ends first: 2026-03-31 compares with all of February.
    previous: { start: isoDate(previousStart), end: isoDate(Math.min(previousStart + (today - start), start - DAY_MS)) },
  };
}

/** Today is still running, so the current window must be complete up to yesterday (or its first day). */
function windowSpecs(windows: HeadlineWindows): Readonly<{ current: WindowSpec; previous: WindowSpec }> {
  return {
    current: { ...windows.current, requiredEnd: maxDate(windows.current.start, addDays(windows.current.end, -1)) },
    previous: { ...windows.previous, requiredEnd: windows.previous.end },
  };
}

// Money: running totals to daily amounts.

type MoneyMeasure = "revenue" | "spend";

function moneyMeasure(kind: SnapshotInput["kind"]): MoneyMeasure | null {
  if (kind === "revenue") return "revenue";
  if (kind === "verified_spend" || kind === "estimated_spend") return "spend";
  return null;
}

/** A row of a running total over a period that starts on a UTC day boundary. */
function isRunningTotal(row: SnapshotInput): boolean {
  if (moneyMeasure(row.kind) === null || row.currency === null || row.amount_minor === null) return false;
  if (row.period_start === null || row.period_end === null) return false;
  // Rolling windows such as Stripe's last 30 days start at an arbitrary instant and are skipped.
  return Date.parse(row.period_start) % DAY_MS === 0;
}

function periodContains(outer: SnapshotInput, inner: SnapshotInput): boolean {
  const outerStart = Date.parse(outer.period_start ?? "");
  const outerEnd = Date.parse(outer.period_end ?? "");
  const innerStart = Date.parse(inner.period_start ?? "");
  const innerEnd = Date.parse(inner.period_end ?? "");
  if (outerStart === innerStart && outerEnd === innerEnd) return false;
  return outerStart <= innerStart && innerEnd <= outerEnd;
}

/**
 * One day's readings with each amount once: breakdowns of a total go (`dropSupersededBreakdowns`),
 * and so does a row whose period sits strictly inside another row's period for the same account,
 * kind, and currency, such as GitHub's daily spend inside its month (the rule #137 applies to the
 * dashboard's current values).
 */
function countedOnDay(rows: readonly SnapshotInput[]): SnapshotInput[] {
  const kept = dropSupersededBreakdowns(rows);
  return kept.filter(
    (row) =>
      !kept.some(
        (outer) =>
          outer !== row &&
          outer.external_account_id === row.external_account_id &&
          outer.kind === row.kind &&
          outer.currency === row.currency &&
          periodContains(outer, row),
      ),
  );
}

/** Money that accrued over the UTC days `from` to `to`, both inclusive. */
type Increment = Readonly<{ from: string; to: string; amountMinor: number }>;

type MoneySeries = Readonly<{
  connectionId: string;
  measure: MoneyMeasure;
  currency: string;
  estimated: boolean;
  increments: readonly Increment[];
  /** Start of the period of the newest reading, an ISO timestamp. */
  latestPeriodStart: string;
}>;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

function buildMoneySeries(rows: readonly SnapshotInput[]): MoneySeries[] {
  const byDay = groupBy(rows.filter(isRunningTotal), (row) => row.snapshot_date);
  const counted = [...byDay.values()].flatMap(countedOnDay);
  const bySeries = groupBy(
    counted,
    (row) => `${row.connection_id} ${row.external_account_id} ${row.kind} ${row.metric_key} ${row.currency ?? ""}`,
  );
  const series: MoneySeries[] = [];
  for (const list of bySeries.values()) {
    list.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const increments: Increment[] = [];
    let previous: SnapshotInput | undefined;
    for (const row of list) {
      const amountMinor = row.amount_minor ?? 0;
      const periodStart = Date.parse(row.period_start ?? "");
      const periodFirstDay = isoDate(periodStart);
      if (previous !== undefined && Date.parse(previous.period_start ?? "") === periodStart) {
        increments.push({
          from: addDays(previous.snapshot_date, 1),
          to: row.snapshot_date,
          amountMinor: amountMinor - (previous.amount_minor ?? 0),
        });
      } else if (periodFirstDay <= row.snapshot_date) {
        increments.push({ from: periodFirstDay, to: row.snapshot_date, amountMinor });
      } else {
        // Read before its period started: nothing has accrued yet.
        continue;
      }
      previous = row;
    }
    const first = list[0];
    const latest = list.at(-1);
    const measure = first === undefined ? null : moneyMeasure(first.kind);
    if (first === undefined || latest === undefined || measure === null || increments.length === 0) continue;
    series.push({
      connectionId: first.connection_id,
      measure,
      currency: first.currency ?? "",
      estimated: isEstimated(first),
      increments,
      latestPeriodStart: latest.period_start ?? "",
    });
  }
  return series;
}

type SeriesInWindow =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "incomplete" }>
  | Readonly<{ status: "complete"; amountMinor: number }>;

/**
 * A series in one window. Absent when it started after the window or stopped before it; incomplete
 * when an amount spans a window edge or a required day has no reading.
 */
function seriesInWindow(series: MoneySeries, window: WindowSpec): SeriesInWindow {
  const first = series.increments.reduce((min, { from }) => (from < min ? from : min), series.increments[0]?.from ?? "");
  const last = series.increments.reduce((max, { to }) => (to > max ? to : max), "");
  if (first > window.end || last < addDays(window.start, -1)) return { status: "absent" };
  let amountMinor = 0;
  const inside: Increment[] = [];
  for (const increment of series.increments) {
    if (increment.to < window.start || increment.from > window.end) continue;
    if (increment.from < window.start || increment.to > window.end) return { status: "incomplete" };
    amountMinor += increment.amountMinor;
    inside.push(increment);
  }
  let next = maxDate(window.start, first);
  for (const increment of inside.sort((a, b) => a.from.localeCompare(b.from))) {
    if (increment.from > next) break;
    if (increment.to >= next) next = addDays(increment.to, 1);
  }
  return next <= window.requiredEnd ? { status: "incomplete" } : { status: "complete", amountMinor };
}

/** Amounts per currency and provenance, keyed `USD verified` or `USD estimated`. */
type Totals = Map<string, number>;

const totalsKey = (currency: string, estimated: boolean) => `${currency} ${estimated ? "estimated" : "verified"}`;

function addTotals(into: Totals, from: Totals, sign = 1): void {
  for (const [key, amount] of from) into.set(key, (into.get(key) ?? 0) + sign * amount);
}

/** One connection's amounts for one measure in one window, or null when it is unavailable. */
function moneySource(series: readonly MoneySeries[], window: WindowSpec): Totals | null {
  const totals: Totals = new Map();
  let reported = false;
  for (const entry of series) {
    const result = seriesInWindow(entry, window);
    if (result.status === "incomplete") return null;
    if (result.status === "absent") continue;
    reported = true;
    const key = totalsKey(entry.currency, entry.estimated);
    totals.set(key, (totals.get(key) ?? 0) + result.amountMinor);
  }
  return reported ? totals : null;
}

// Figures.

export type FigureValue = Readonly<{ value: number; comparison: TrendComparison }>;

/** One currency. Verified and estimated are never added together; null when there is none. */
export type MoneyLine = Readonly<{ currency: string; verified: FigureValue | null; estimated: FigureValue | null }>;

export type FigureSources = Readonly<{
  /** Provider names behind the current value. */
  included: readonly string[];
  /** Provider names that could not report the window; never counted as zero. */
  unavailable: readonly string[];
  /** Provider names behind the current value with no complete previous window, so no comparison. */
  previousUnavailable: readonly string[];
}>;

/** `lines` is null when no source could report the window. */
export type MoneyFigure = FigureSources & Readonly<{ lines: readonly MoneyLine[] | null }>;

/** `value` is null when no source could report the window. */
export type CountFigure = FigureSources & Readonly<{ value: FigureValue | null }>;

export type DeploysFigure = CountFigure & Readonly<{ failed: number | null }>;

export type CostPerSignupFigure = Readonly<{
  /** null when spend or signups are unavailable, or there were no signups. */
  lines: readonly MoneyLine[] | null;
  missing: "spend" | "signups" | "no_signups" | null;
  spendFrom: readonly string[];
  signupsFrom: readonly string[];
  /** Left out because they could not report the window. */
  spendUnavailable: readonly string[];
  signupsUnavailable: readonly string[];
}>;

export type HeadlineStrip = Readonly<{
  windows: HeadlineWindows;
  revenue: MoneyFigure;
  spend: MoneyFigure;
  net: MoneyFigure;
  signups: CountFigure;
  costPerSignup: CostPerSignupFigure;
  deploys: DeploysFigure;
  /** Providers in the money figures whose own billing period is not this window. */
  otherBillingPeriods: readonly string[];
  /** True when any connection behind a figure was made by the provider simulator (#131). */
  simulated: boolean;
}>;

export type HeadlineInput = Readonly<{
  /** Snapshot history already narrowed to the scope filter, reaching back before the previous window. */
  snapshots: readonly SnapshotInput[];
  /** Connections already narrowed to the scope filter. */
  connections: readonly ConnectionInput[];
  /** Event counts per connection and type, for the included accounts in scope, per window. */
  events: Readonly<{ current: readonly EventCount[]; previous: readonly EventCount[] }>;
  kind: HeadlineWindowKind;
  now: Date;
}>;

function names(connections: readonly ConnectionInput[]): string[] {
  return [...new Set(connections.map((connection) => providerName(connection.provider)))].sort((a, b) => a.localeCompare(b));
}

/** Current and previous totals for one figure, with the connections behind them. */
type Assembled = Readonly<{
  current: Totals | null;
  /** null when there is no comparison. */
  previous: Totals | null;
  included: ConnectionInput[];
  unavailable: ConnectionInput[];
  previousUnavailable: ConnectionInput[];
}>;

/** Each candidate's value in both windows; `valueOf` returns null when it cannot report one. */
function assemble(
  candidates: readonly ConnectionInput[],
  valueOf: (connection: ConnectionInput, window: WindowSpec) => Totals | null,
  specs: Readonly<{ current: WindowSpec; previous: WindowSpec }>,
): Assembled {
  const included: ConnectionInput[] = [];
  const unavailable: ConnectionInput[] = [];
  const previousUnavailable: ConnectionInput[] = [];
  const current: Totals = new Map();
  const previous: Totals = new Map();
  for (const connection of candidates) {
    const inCurrent = valueOf(connection, specs.current);
    if (inCurrent === null) {
      unavailable.push(connection);
      continue;
    }
    included.push(connection);
    addTotals(current, inCurrent);
    const inPrevious = valueOf(connection, specs.previous);
    if (inPrevious === null) previousUnavailable.push(connection);
    else addTotals(previous, inPrevious);
  }
  return {
    current: included.length === 0 ? null : current,
    previous: included.length === 0 || previousUnavailable.length > 0 ? null : previous,
    included,
    unavailable,
    previousUnavailable,
  };
}

function sourcesOf(assembled: Assembled): FigureSources {
  return {
    included: names(assembled.included),
    unavailable: names(assembled.unavailable),
    previousUnavailable: names(assembled.previousUnavailable),
  };
}

/**
 * Lines per currency, sorted by code. With a comparison, a currency or provenance on only one side
 * is zero on the other: every connection behind the figure reported both windows in full.
 */
function toLines(current: Totals, previous: Totals | null): MoneyLine[] {
  const keys = new Set([...current.keys(), ...(previous?.keys() ?? [])]);
  const currencies = [...new Set([...keys].map((key) => key.split(" ")[0] ?? ""))].sort();
  const valueFor = (currency: string, estimated: boolean): FigureValue | null => {
    const key = totalsKey(currency, estimated);
    if (!keys.has(key)) return null;
    const value = current.get(key) ?? 0;
    return { value, comparison: compareValues(value, previous === null ? null : (previous.get(key) ?? 0)) };
  };
  return currencies.map((currency) => ({ currency, verified: valueFor(currency, false), estimated: valueFor(currency, true) }));
}

function moneyFigure(assembled: Assembled): MoneyFigure {
  return { ...sourcesOf(assembled), lines: assembled.current === null ? null : toLines(assembled.current, assembled.previous) };
}

function countFigure(assembled: Assembled): CountFigure {
  const total = (totals: Totals | null) => (totals === null ? null : [...totals.values()].reduce((sum, value) => sum + value, 0));
  const current = total(assembled.current);
  return {
    ...sourcesOf(assembled),
    value: current === null ? null : { value: current, comparison: compareValues(current, total(assembled.previous)) },
  };
}

function divideTotals(totals: Totals, count: number): Totals {
  return new Map([...totals].map(([key, amount]) => [key, divideMinorUnits(amount, count)]));
}

export function buildHeadline(input: HeadlineInput): HeadlineStrip {
  const windows = headlineWindows(input.kind, input.now);
  const specs = windowSpecs(windows);
  const connections = [...input.connections].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id),
  );
  const inScope = new Set(connections.map((connection) => connection.id));
  const series = buildMoneySeries(input.snapshots.filter((row) => inScope.has(row.connection_id)));
  const seriesOf = (connection: ConnectionInput, measure: MoneyMeasure) =>
    series.filter((entry) => entry.connectionId === connection.id && entry.measure === measure);

  // Money.
  const moneyOf = (measure: MoneyMeasure) => (connection: ConnectionInput, window: WindowSpec) =>
    moneySource(seriesOf(connection, measure), window);
  const revenueCandidates = connections.filter(
    (connection) => REVENUE_PROVIDERS.includes(connection.provider) || seriesOf(connection, "revenue").length > 0,
  );
  const revenue = assemble(revenueCandidates, moneyOf("revenue"), specs);
  // Every connection can cost money, so one that cannot report spend is named rather than skipped.
  const spend = assemble(connections, moneyOf("spend"), specs);

  // Events.
  const firstReading = new Map<string, string>();
  for (const row of input.snapshots) {
    const first = firstReading.get(row.connection_id);
    if (first === undefined || row.snapshot_date < first) firstReading.set(row.connection_id, row.snapshot_date);
  }
  const countsFor = (window: WindowSpec) => (window === specs.current ? input.events.current : input.events.previous);
  const eventsOf = (typeIds: readonly string[]) => (connection: ConnectionInput, window: WindowSpec) => {
    const first = firstReading.get(connection.id);
    if (first === undefined || first > window.start) return null;
    if (connection.last_synced_at === null || Date.parse(connection.last_synced_at) < dayStart(window.requiredEnd)) return null;
    const events = countsFor(window)
      .filter((count) => count.connection_id === connection.id && typeIds.includes(count.type_id))
      .reduce((sum, count) => sum + count.events, 0);
    return new Map([["count", events]]) satisfies Totals;
  };
  const ownsAny = (typeIds: readonly string[]) => (connection: ConnectionInput) =>
    typeIds.some((typeId) => typeId.split(".")[0] === connection.provider);
  const deployTypes = Object.keys(DEPLOY_EVENT_TYPES);
  const failedTypes = deployTypes.filter((typeId) => DEPLOY_EVENT_TYPES[typeId] === "failed");
  const signups = assemble(connections.filter(ownsAny(SIGNUP_EVENT_TYPES)), eventsOf(SIGNUP_EVENT_TYPES), specs);
  const deploys = assemble(connections.filter(ownsAny(deployTypes)), eventsOf(deployTypes), specs);
  const signupsFigure = countFigure(signups);
  const deploysFigure = countFigure(deploys);
  const failed = deploysFigure.value === null ? null : deploys.included.reduce((sum, connection) => {
    return sum + (eventsOf(failedTypes)(connection, specs.current)?.get("count") ?? 0);
  }, 0);

  // Revenue minus spend: both sides must have a source. Unavailable sources on either side are named.
  const netTotals = (revenueTotals: Totals | null, spendTotals: Totals | null): Totals | null => {
    if (revenueTotals === null || spendTotals === null) return null;
    const totals: Totals = new Map();
    addTotals(totals, revenueTotals);
    addTotals(totals, spendTotals, -1);
    return totals;
  };
  const netCurrent = netTotals(revenue.current, spend.current);
  const net: MoneyFigure = {
    included: names([...revenue.included, ...spend.included]),
    unavailable: names([...revenue.unavailable, ...spend.unavailable]),
    previousUnavailable: names([...revenue.previousUnavailable, ...spend.previousUnavailable]),
    lines: netCurrent === null ? null : toLines(netCurrent, netTotals(revenue.previous, spend.previous)),
  };

  // Cost per signup: spend over signups, per currency and provenance, only when both are there.
  const signupCount = signupsFigure.value?.value ?? null;
  const previousSignups = signups.previous === null ? null : (signups.previous.get("count") ?? 0);
  const missing =
    spend.current === null ? "spend" : signupCount === null ? "signups" : signupCount === 0 ? "no_signups" : null;
  const costPerSignup: CostPerSignupFigure = {
    lines:
      missing !== null || spend.current === null || signupCount === null
        ? null
        : toLines(
            divideTotals(spend.current, signupCount),
            spend.previous === null || previousSignups === null || previousSignups === 0
              ? null
              : divideTotals(spend.previous, previousSignups),
          ),
    missing,
    spendFrom: names(spend.included),
    signupsFrom: names(signups.included),
    spendUnavailable: names(spend.unavailable),
    signupsUnavailable: names(signups.unavailable),
  };

  // A provider's billing period differs from the window unless it starts on the window's first day.
  const moneySources = [...new Set([...revenue.included, ...spend.included])];
  const otherBillingPeriods = names(
    moneySources.filter((connection) =>
      series.some(
        (entry) =>
          entry.connectionId === connection.id &&
          (windows.kind === "week" || isoDate(Date.parse(entry.latestPeriodStart)) !== windows.current.start),
      ),
    ),
  );

  const behindFigures = [...revenue.included, ...spend.included, ...signups.included, ...deploys.included];
  return {
    windows,
    revenue: moneyFigure(revenue),
    spend: moneyFigure(spend),
    net,
    signups: signupsFigure,
    costPerSignup,
    deploys: { ...deploysFigure, failed },
    otherBillingPeriods,
    simulated: behindFigures.some(isSimulatedConnection),
  };
}

// Copy. US English, sentence case, no dashes; days are UTC dates because snapshot days are.

const WINDOW_WORDS = {
  week: { title: "This week so far", previous: "the same days last week", choice: "This week" },
  month: { title: "This month so far", previous: "the same days last month", choice: "This month" },
} as const satisfies Record<HeadlineWindowKind, Record<string, string>>;

export function headlineTitle(kind: HeadlineWindowKind): string {
  return WINDOW_WORDS[kind].title;
}

export function headlineChoiceLabel(kind: HeadlineWindowKind): string {
  return WINDOW_WORDS[kind].choice;
}

function rangeText(range: DateRange): string {
  return range.start === range.end ? range.start : `${range.start} to ${range.end}`;
}

/** "2026-11-02 to 2026-11-05 in UTC, compared with 2026-10-26 to 2026-10-29." */
export function windowDescription(windows: HeadlineWindows): string {
  return `${rangeText(windows.current)} in UTC, compared with ${rangeText(windows.previous)}.`;
}

/** "A, B, and C". */
export function listNames(values: readonly string[]): string {
  if (values.length <= 2) return values.join(" and ");
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1) ?? ""}`;
}

/**
 * "Up 12 percent from $1,100.00 on the same days last week", or why there is no comparison.
 * Direction is always a word, never only a color.
 */
export function headlineComparisonText(
  comparison: TrendComparison,
  format: (value: number) => string,
  kind: HeadlineWindowKind,
  previousUnavailable: readonly string[] = [],
): string {
  const previous = WINDOW_WORDS[kind].previous;
  if (comparison.status === "unavailable") {
    return previousUnavailable.length > 0
      ? `No comparison: ${listNames(previousUnavailable)} could not report ${previous}`
      : `No comparison: ${previous} are unavailable`;
  }
  const from = `${format(comparison.previous)} on ${previous}`;
  if (comparison.direction === "same") return `No change from ${from}`;
  const direction = comparison.direction === "up" ? "Up" : "Down";
  if (comparison.percent === null) return `${direction} from ${from}`;
  const rounded = Math.round(comparison.percent);
  return rounded === 0 ? `${direction} less than 1 percent from ${from}` : `${direction} ${rounded} percent from ${from}`;
}

export function formatCount(value: number, singular: string, plural: string): string {
  return formatQuantity(value, value === 1 ? singular : plural);
}

export function moneyFormatter(currency: string): (value: number) => string {
  return (value) => formatMoney(value, currency);
}

/** The cost per signup explanation: exactly which providers went into it. */
export function costPerSignupExplanation(figure: CostPerSignupFigure): string {
  const parts: string[] = [];
  if (figure.spendFrom.length > 0 && figure.signupsFrom.length > 0) {
    parts.push(`Spend from ${listNames(figure.spendFrom)}, divided by signups from ${listNames(figure.signupsFrom)}.`);
  }
  if (figure.spendUnavailable.length > 0) {
    parts.push(`Leaves out spend from ${listNames(figure.spendUnavailable)}, unavailable for this window.`);
  }
  if (figure.signupsUnavailable.length > 0) {
    parts.push(`Leaves out signups from ${listNames(figure.signupsUnavailable)}, unavailable for this window.`);
  }
  parts.push("Each currency on its own, verified and estimated spend apart, rounded once to the currency's smallest unit.");
  return parts.join(" ");
}
