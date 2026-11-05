/**
 * Pure projections to the end of a billing period (#167): where spend and quota usage are heading
 * if the recent daily rate holds. No I/O and no clock: the caller passes `now`, so every rule
 * here is unit tested at its boundaries.
 *
 * Rules decided here, once:
 * - A projection is an estimate by DevMacro. It is shown beside verified and estimated amounts
 *   and never added to either.
 * - Linear on the recent daily rate: the change between the first and the last of the latest
 *   PROJECTION_WINDOW_POINTS daily points of the current period, divided by the time between
 *   their readings, continued from the last reading to the end of the period.
 * - At least MIN_PROJECTION_DAYS UTC days with a reading in the current period, else nothing is
 *   projected ("too_few_days"). A period with no known end ("unknown_period") or one that has
 *   already ended ("period_ended") is not projected either.
 * - The current period is the latest reading's: readings with another period start, or for a
 *   point reading another reset time, belong to a period that has ended and are ignored. A value
 *   that falls within the period (a reset or a correction the provider did not announce) starts
 *   the series again from the lower value, so the rate is never negative.
 * - The end of the period is the reset time when there is one, else the stored period end when
 *   the window runs past the day it was read. A window "to date" that starts at a UTC month start
 *   is taken to end at the next UTC month start, and the explanation says so (decision recorded
 *   on #167). Anything else has no known end.
 * - Money: per external account and currency, verified spend is projected; estimated spend only
 *   for an account with no current verified spend in that currency, the rule `evaluate.ts` applies
 *   to spend alerts (7e35963). Projections are summed unrounded and rounded once, half up, to
 *   minor units when shown (`projectedMinor`).
 * - A quota runs out when its used amount is projected to reach the allowance before the reset.
 *   One already at or over its allowance is used up: an observed reading, not an estimate.
 * - A projection never raises an alert (decision recorded on #167): an alert records observed
 *   values only, once per rule and cycle.
 */
import { formatDateTime, formatMoney, formatQuantity, formatUtcDate } from "@/lib/format";

import {
  dropSupersededBreakdowns,
  isCurrentPeriod,
  isEstimated,
  latestSnapshots,
  type DashboardInput,
  type SnapshotInput,
} from "./aggregate";

export const MIN_PROJECTION_DAYS = 3;
export const PROJECTION_WINDOW_POINTS = 7;

const DAY_MS = 86_400_000;

export type UnavailableReason = "too_few_days" | "unknown_period" | "period_ended";

/** When the projected period ends. `assumed` when DevMacro took it to be the calendar month. */
export type PeriodEnd = Readonly<{ at: string; assumed: boolean }>;

/** One reading a day: the UTC snapshot date, the instant it was read, and the value then. */
export type SeriesPoint = Readonly<{ date: string; at: string; value: number }>;

/** What a projection was calculated from, for the explanation shown beside it. */
export type ProjectionBasis = Readonly<{
  /** First and last UTC snapshot dates used. */
  from: string;
  to: string;
  days: number;
  ratePerDay: number;
  /** The instant of the last reading the projection continues from. */
  lastReadAt: string;
}>;

export type Projected = Readonly<{
  status: "projected";
  current: number;
  /** Unrounded; see `projectedMinor` for money. */
  projected: number;
  /** The latest end when several periods were summed. */
  periodEnd: PeriodEnd;
  /** True when the summed periods end at different times. */
  endsDiffer: boolean;
  basis: ProjectionBasis;
}>;

export type Projection = Readonly<{ status: "unavailable"; reason: UnavailableReason }> | Projected;

export type SpendProjection = Readonly<{
  currency: string;
  /** True when an account with no verified spend had its estimated spend projected. */
  includesEstimates: boolean;
  projection: Projection;
}>;

export type QuotaProjection =
  | Readonly<{ status: "unavailable"; reason: UnavailableReason }>
  | Readonly<{ status: "used_up"; used: number; included: number; unit: string }>
  | Readonly<{ status: "within"; included: number; unit: string; projection: Projected }>
  | Readonly<{ status: "runs_out"; at: string; included: number; unit: string; projection: Projected }>;

/** One allowance's projection with the allowance's label, for surfaces that name it. */
export type AllowanceProjection = Readonly<{ label: string; quota: QuotaProjection }>;

function unavailable(reason: UnavailableReason): Readonly<{ status: "unavailable"; reason: UnavailableReason }> {
  return { status: "unavailable", reason };
}

function iso(at: string | number): string {
  return new Date(at).toISOString();
}

/**
 * Projects a series of daily readings to `periodEnd`. The points may be in any order; dates are
 * expected to be distinct (one stored row per day), and the newest reading of a date wins if not.
 */
export function projectSeries(points: readonly SeriesPoint[], periodEnd: PeriodEnd | null, now: Date): Projection {
  if (periodEnd === null) return unavailable("unknown_period");
  const endMs = Date.parse(periodEnd.at);
  if (endMs <= now.getTime()) return unavailable("period_ended");

  const byDate = new Map<string, SeriesPoint>();
  for (const point of points) {
    const current = byDate.get(point.date);
    if (current === undefined || Date.parse(point.at) > Date.parse(current.at)) byDate.set(point.date, point);
  }
  const sorted = [...byDate.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let start = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const point = sorted[index];
    if (previous !== undefined && point !== undefined && point.value < previous.value) start = index;
  }
  const window = sorted.slice(start).slice(-PROJECTION_WINDOW_POINTS);
  const first = window[0];
  const last = window.at(-1);
  if (first === undefined || last === undefined || window.length < MIN_PROJECTION_DAYS) return unavailable("too_few_days");
  const firstMs = Date.parse(first.at);
  const lastMs = Date.parse(last.at);
  // Distinct UTC dates read in order cannot share an instant; a clock that says otherwise has no rate.
  if (!(lastMs > firstMs)) return unavailable("too_few_days");

  const ratePerMs = (last.value - first.value) / (lastMs - firstMs);
  return {
    status: "projected",
    current: last.value,
    projected: last.value + ratePerMs * Math.max(0, endMs - lastMs),
    periodEnd,
    endsDiffer: false,
    basis: { from: first.date, to: last.date, days: window.length, ratePerDay: ratePerMs * DAY_MS, lastReadAt: iso(last.at) },
  };
}

/**
 * The end of the period a reading belongs to, or null when it is unknown. See the rules above:
 * the reset time, else a stored end past the day of the reading, else the calendar month for a
 * window to date that starts at a UTC month start.
 */
export function periodEndOf(row: Pick<SnapshotInput, "period_start" | "period_end" | "resets_at" | "retrieved_at">): PeriodEnd | null {
  if (row.resets_at !== null) return { at: iso(row.resets_at), assumed: false };
  if (row.period_start === null || row.period_end === null) return null;
  const end = Date.parse(row.period_end);
  // UTC days start at multiples of DAY_MS, so this is the end of the UTC day of the reading.
  const readDayEnd = (Math.floor(Date.parse(row.retrieved_at) / DAY_MS) + 1) * DAY_MS;
  if (end > readDayEnd) return { at: iso(end), assumed: false };
  const start = new Date(row.period_start);
  if (start.getTime() !== Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)) return null;
  const monthEnd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  return { at: iso(monthEnd), assumed: end !== monthEnd };
}

/** Which period a reading belongs to: its period start, else its reset time to the minute. */
function cycleOf(row: SnapshotInput): string | null {
  if (row.period_start !== null && row.period_end !== null) return `period:${Date.parse(row.period_start)}`;
  if (row.resets_at !== null) return `resets:${iso(row.resets_at).slice(0, 16)}`;
  return null;
}

/**
 * Projects one metric from its stored rows (one external account, one metric key). `valueOf`
 * reads the number to project, or null to skip a row.
 */
export function projectMetric(
  rows: readonly SnapshotInput[],
  valueOf: (row: SnapshotInput) => number | null,
  now: Date,
): Projection {
  const latest = latestSnapshots(rows)[0];
  if (latest === undefined) return unavailable("too_few_days");
  const cycle = cycleOf(latest);
  if (cycle === null) return unavailable("unknown_period");
  const points: SeriesPoint[] = [];
  for (const row of rows) {
    const value = valueOf(row);
    if (value !== null && cycleOf(row) === cycle) points.push({ date: row.snapshot_date, at: row.retrieved_at, value });
  }
  return projectSeries(points, periodEndOf(latest), now);
}

const REASON_ORDER: readonly UnavailableReason[] = ["unknown_period", "period_ended", "too_few_days"];

/** The sum of several projections, unrounded; unavailable when any part is. */
export function sumProjections(parts: readonly Projection[]): Projection {
  const missing = REASON_ORDER.find((reason) => parts.some((part) => part.status === "unavailable" && part.reason === reason));
  if (missing !== undefined) return unavailable(missing);
  const projected = parts.filter((part): part is Projected => part.status === "projected");
  const [first, ...rest] = projected;
  if (first === undefined) return unavailable("too_few_days");
  return rest.reduce<Projected>((sum, part) => {
    const later = Date.parse(part.periodEnd.at) > Date.parse(sum.periodEnd.at);
    return {
      status: "projected",
      current: sum.current + part.current,
      projected: sum.projected + part.projected,
      periodEnd: { at: later ? part.periodEnd.at : sum.periodEnd.at, assumed: sum.periodEnd.assumed || part.periodEnd.assumed },
      endsDiffer: sum.endsDiffer || part.endsDiffer || Date.parse(part.periodEnd.at) !== Date.parse(sum.periodEnd.at),
      basis: {
        from: part.basis.from < sum.basis.from ? part.basis.from : sum.basis.from,
        to: part.basis.to > sum.basis.to ? part.basis.to : sum.basis.to,
        days: Math.min(sum.basis.days, part.basis.days),
        ratePerDay: sum.basis.ratePerDay + part.basis.ratePerDay,
        lastReadAt: Date.parse(part.basis.lastReadAt) > Date.parse(sum.basis.lastReadAt) ? part.basis.lastReadAt : sum.basis.lastReadAt,
      },
    };
  }, first);
}

/** The projected amount in minor units, rounded once, half up. */
export function projectedMinor(projection: Projected): number {
  return Math.round(projection.projected);
}

function metricKey(row: Pick<SnapshotInput, "external_account_id" | "metric_key">): string {
  return `${row.external_account_id} ${row.metric_key}`;
}

function historyByMetric(rows: readonly SnapshotInput[]): Map<string, SnapshotInput[]> {
  const history = new Map<string, SnapshotInput[]>();
  for (const row of rows) {
    const list = history.get(metricKey(row));
    if (list === undefined) history.set(metricKey(row), [row]);
    else list.push(row);
  }
  return history;
}

/**
 * Spend projected to the end of the billing period, per currency, from rows already narrowed to
 * what should be counted (a connection, a provider, a budget's scope, or the whole dashboard).
 * Sorted by currency code.
 */
export function projectSpend(rows: readonly SnapshotInput[], now: Date): SpendProjection[] {
  const current = dropSupersededBreakdowns(latestSnapshots(rows)).filter(
    (row) =>
      (row.kind === "verified_spend" || row.kind === "estimated_spend") &&
      row.currency !== null &&
      row.amount_minor !== null &&
      isCurrentPeriod(row, now),
  );
  const verified = new Set(current.filter((row) => row.kind === "verified_spend").map((row) => `${row.external_account_id} ${row.currency}`));
  const history = historyByMetric(rows);
  const byCurrency = new Map<string, { parts: Projection[]; includesEstimates: boolean }>();
  for (const row of current) {
    const { currency } = row;
    if (currency === null) continue;
    if (row.kind === "estimated_spend" && verified.has(`${row.external_account_id} ${currency}`)) continue;
    const projection = projectMetric(
      history.get(metricKey(row)) ?? [],
      (candidate) => (candidate.currency === currency ? candidate.amount_minor : null),
      now,
    );
    const bucket = byCurrency.get(currency) ?? { parts: [], includesEstimates: false };
    bucket.parts.push(projection);
    bucket.includesEstimates ||= isEstimated(row);
    byCurrency.set(currency, bucket);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, { parts, includesEstimates }]) => ({ currency, includesEstimates, projection: sumProjections(parts) }));
}

/**
 * Run-out projections per allowance, keyed like the dashboard's allowances
 * (`<external account id>:<key prefix>`). An allowance pairs an `included_allowance` with the
 * first `usage` metric (by key) of the same account, key prefix, and unit, as on the dashboard;
 * allowances with no usage metric, or an allowance that is not above zero, are left out.
 */
export function projectAllowances(rows: readonly SnapshotInput[], now: Date): Map<string, AllowanceProjection> {
  type Group = { included?: SnapshotInput; usage: SnapshotInput[] };
  const groups = new Map<string, Group>();
  for (const row of dropSupersededBreakdowns(latestSnapshots(rows))) {
    if (row.kind !== "included_allowance" && row.kind !== "usage") continue;
    const key = `${row.external_account_id}:${row.metric_key.slice(0, row.metric_key.lastIndexOf("."))}`;
    const group = groups.get(key) ?? { usage: [] };
    if (row.kind === "included_allowance") group.included ??= row;
    else group.usage.push(row);
    groups.set(key, group);
  }

  const history = historyByMetric(rows);
  const result = new Map<string, AllowanceProjection>();
  for (const [key, group] of groups) {
    const { included } = group;
    if (included === undefined || included.unit === null || included.value === null || !(included.value > 0)) continue;
    const unit = included.unit;
    const used = group.usage.filter((row) => row.unit === unit).sort((a, b) => a.metric_key.localeCompare(b.metric_key))[0];
    if (used === undefined || used.value === null) continue;
    result.set(key, { label: included.label, quota: quotaOf(history.get(metricKey(used)) ?? [], used.value, included.value, unit, now) });
  }
  return result;
}

function quotaOf(usedHistory: readonly SnapshotInput[], used: number, limit: number, unit: string, now: Date): QuotaProjection {
  if (used >= limit) return { status: "used_up", used, included: limit, unit };
  const projection = projectMetric(usedHistory, (row) => (row.unit === unit ? row.value : null), now);
  if (projection.status === "unavailable") return projection;
  const { ratePerDay, lastReadAt } = projection.basis;
  const crossesAt = ratePerDay > 0 ? Date.parse(lastReadAt) + ((limit - projection.current) / ratePerDay) * DAY_MS : Infinity;
  return crossesAt < Date.parse(projection.periodEnd.at)
    ? { status: "runs_out", at: iso(crossesAt), included: limit, unit, projection }
    : { status: "within", included: limit, unit, projection };
}

/**
 * Whether a spend projection reaches a budget amount, or null when nothing is projected. Reaching
 * it counts, as a threshold is crossed at or above it in `evaluate.ts`.
 */
export function projectedToCross(spend: SpendProjection, amountMinor: number): boolean | null {
  return spend.projection.status === "projected" ? projectedMinor(spend.projection) >= amountMinor : null;
}

export type DashboardProjections = Readonly<{
  /** Per currency, over every connection shown, like the totals. */
  totals: readonly SpendProjection[];
  byConnection: ReadonlyMap<string, readonly SpendProjection[]>;
  /** Keyed like `Allowance.key`. */
  quotas: ReadonlyMap<string, AllowanceProjection>;
}>;

/**
 * Projections for the dashboard, from the same input as `aggregateDashboard`: rows of accounts
 * not included, or whose account moved connection, are skipped the same way.
 */
export function projectDashboard(input: DashboardInput): DashboardProjections {
  const connections = new Set(input.connections.map((connection) => connection.id));
  const accountConnection = new Map(input.accounts.map((account) => [account.id, account.connection_id]));
  const byConnection = new Map<string, SnapshotInput[]>();
  const rows: SnapshotInput[] = [];
  for (const row of input.snapshots) {
    if (!connections.has(row.connection_id) || accountConnection.get(row.external_account_id) !== row.connection_id) continue;
    rows.push(row);
    const list = byConnection.get(row.connection_id);
    if (list === undefined) byConnection.set(row.connection_id, [row]);
    else list.push(row);
  }
  return {
    totals: projectSpend(rows, input.now),
    byConnection: new Map([...byConnection].map(([id, list]) => [id, projectSpend(list, input.now)])),
    quotas: projectAllowances(rows, input.now),
  };
}

// Wording. US English, no dashes, sentence case. Period ends are exclusive instants, so the last
// day shown is the UTC day before them, the way billing periods are shown elsewhere.

export type ProjectionText = Readonly<{ headline: string; explanation: string }>;

const REASON_TEXT: Record<UnavailableReason, string> = {
  too_few_days: `DevMacro needs at least ${MIN_PROJECTION_DAYS} days of data in the current period to project it.`,
  unknown_period: "The provider does not say when the current period ends.",
  period_ended: "The current period has ended.",
};

/** The reason in a few words, for one line summaries. */
const REASON_PHRASE: Record<UnavailableReason, string> = {
  too_few_days: `fewer than ${MIN_PROJECTION_DAYS} days of data`,
  unknown_period: "the end of the period is unknown",
  period_ended: "the period has ended",
};

/** The last day of a period ending at `periodEnd`, as a UTC date. */
function lastDayOf(periodEnd: PeriodEnd): string {
  return formatUtcDate(new Date(Date.parse(periodEnd.at) - 1));
}

function endPhrase(projection: Projected): string {
  const last = lastDayOf(projection.periodEnd);
  return projection.endsDiffer ? `the end of each billing period (the last ends ${last})` : last;
}

function basisPhrase(basis: ProjectionBasis, rate: string): string {
  const days = `${basis.days} days with data (${basis.from} to ${basis.to})`;
  return `Calculated by DevMacro, not reported by the provider: the average daily increase over the last ${days}, ${rate} a day, continued to the end of the period.`;
}

const ASSUMED_NOTE = " The provider reports this period to date, so DevMacro assumes it ends with the calendar month.";

/** "On track for $51.75 by 2026-11-30", with how it was calculated, or why there is none. */
export function spendProjectionText(spend: SpendProjection): ProjectionText {
  const { projection, currency } = spend;
  if (projection.status === "unavailable") {
    return { headline: "Projection unavailable", explanation: REASON_TEXT[projection.reason] };
  }
  const explanation =
    basisPhrase(projection.basis, formatMoney(Math.round(projection.basis.ratePerDay), currency)) +
    (projection.periodEnd.assumed ? ASSUMED_NOTE : "") +
    (spend.includesEstimates ? " Includes spend estimated by DevMacro from a price list." : "") +
    " It is never added to the spend shown.";
  return {
    headline: `On track for ${formatMoney(projectedMinor(projection), currency)} by ${endPhrase(projection)}`,
    explanation,
  };
}

/** One line for the daily summary: "Spending on track for $51.75 by 2026-11-30 (estimate by DevMacro)". */
export function spendProjectionLine(spend: SpendProjection): string {
  const { projection, currency } = spend;
  return projection.status === "projected"
    ? `Spending on track for ${formatMoney(projectedMinor(projection), currency)} by ${endPhrase(projection)} (estimate by DevMacro)`
    : `Spending projection in ${currency} unavailable (${REASON_PHRASE[projection.reason]})`;
}

/**
 * One line for the daily summary when a quota runs out before its reset or is used up, else
 * null: a quota that lasts needs no line.
 */
export function quotaProjectionLine({ label, quota }: AllowanceProjection): string | null {
  if (quota.status === "runs_out") return `${label} runs out around ${formatUtcDate(quota.at)} (estimate by DevMacro)`;
  if (quota.status === "used_up") return `${label} used up`;
  return null;
}

/**
 * A spend projection against a budget amount: "Projected to cross" when it reaches the amount.
 * Display only; a projection never raises an alert (decision recorded on #167).
 */
export function budgetProjectionText(spend: SpendProjection, amountMinor: number): ProjectionText & { crosses: boolean } {
  const text = spendProjectionText(spend);
  const crosses = projectedToCross(spend, amountMinor);
  if (crosses === null) return { ...text, crosses: false };
  const budget = formatMoney(amountMinor, spend.currency);
  return {
    headline: `${text.headline}, ${crosses ? "at or above" : "below"} the ${budget} budget`,
    explanation: text.explanation,
    crosses,
  };
}

/** "Runs out around 2026-11-25", "On track for ... by ...", "Allowance used up", or why there is none. */
export function quotaProjectionText(quota: QuotaProjection): ProjectionText {
  switch (quota.status) {
    case "unavailable":
      return { headline: "Projection unavailable", explanation: REASON_TEXT[quota.reason] };
    case "used_up":
      return {
        headline: "Allowance used up",
        explanation: `${formatQuantity(quota.used, quota.unit)} used of ${formatQuantity(quota.included, quota.unit)} before the reset. This is the latest reading, not an estimate.`,
      };
    case "runs_out":
    case "within": {
      const { projection, included, unit } = quota;
      const reset = formatDateTime(projection.periodEnd.at);
      const basis = basisPhrase(projection.basis, formatQuantity(projection.basis.ratePerDay, unit)) + (projection.periodEnd.assumed ? ASSUMED_NOTE : "");
      return quota.status === "runs_out"
        ? {
            headline: `Runs out around ${formatUtcDate(quota.at)}`,
            explanation: `${basis} At that rate the ${formatQuantity(included, unit)} allowance is used up before it resets on ${reset}.`,
          }
        : {
            headline: `On track for ${formatQuantity(projection.projected, unit)} of ${formatQuantity(included, unit)} by ${lastDayOf(projection.periodEnd)}`,
            explanation: `${basis} At that rate the allowance lasts until it resets on ${reset}.`,
          };
    }
  }
}
