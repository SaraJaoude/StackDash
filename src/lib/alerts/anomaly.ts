/**
 * Anomaly detection (#169): flags a day whose spend or usage is far above the recent pattern, with
 * no setup. Pure: rows, connections, and mutes in, anomalies and timeline events out. No I/O and
 * no clock; `src/lib/jobs/daily-summary.ts` loads the inputs and writes the events right after the
 * daily summary for the same UTC day.
 *
 * Rules decided here, once:
 * - Only spend (verified and estimated) and usage count. Allowances, credit balances, and revenue
 *   are levels, not daily activity, and point in time readings (a star count) are gauges, so
 *   neither is ever flagged.
 * - A metric's daily amount comes from its stored rows. When an account's rows never cover more
 *   than one UTC day, each row is that day's amount, dated by the period's first day. Otherwise
 *   the rows are a running total over a period that starts on a UTC day boundary (month to date,
 *   whose period is one day long on the 1st): the day's amount is that day's reading minus the
 *   previous day's reading of the same period. The first day of a period is never counted,
 *   because charges billed once per period (a plan fee) land on it. A missing neighbor or a
 *   running total that went down (a provider correction) makes the day unavailable, never zero.
 *   Rolling windows ("last 30 days", not on a day boundary) cannot be turned into daily amounts
 *   and are skipped.
 * - A series is one provider, one metric key, one currency or unit, and one source. Verified and
 *   estimated values are separate series and the event says which one it used. Accounts are added
 *   up the way trends add them: a day where an account that had started reporting has no amount
 *   is unavailable for the whole series.
 * - A breakdown never fires beside its own total: the dashboard's `.total` rule applies, and so
 *   does its parent rule (`github.spend.actions.actions_linux` is dropped when the account also
 *   reports `github.spend.actions` in the same kind and currency).
 * - The latest complete UTC day is compared with the 14 days before it. It needs at least 7 of
 *   them, and it fires only when all three hold: the day is at least twice the median, it is above
 *   the median by at least the minimum change for its currency or unit, and its modified z-score
 *   (0.6745 times the distance from the median, over the median absolute deviation) is above
 *   3.5, the outlier cutoff Iglewicz and Hoaglin recommend (NIST/SEMATECH e-Handbook of
 *   Statistical Methods, section 1.3.5.17, "Detection of Outliers"). The median and its absolute
 *   deviation are robust: one past spike moves neither, so it cannot hide the next one, and a
 *   steady ramp stays inside its own spread.
 * - Only spikes fire. A drop (weekends, a quiet day) is the normal rhythm of most workspaces.
 */
import { isEstimated, type ProviderId, type SnapshotInput } from "@/lib/dashboard/aggregate";
import { formatTrendValue, type TrendMeasure } from "@/lib/dashboard/trends";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { currencyMinorDigits } from "@/lib/money";
import { providerName } from "@/lib/providers";

export const ANOMALY_TYPE_ID = "devmacro.anomaly_detected";

/** Days before the checked day that make up its usual pattern. */
export const ANOMALY_WINDOW_DAYS = 14;
/** Fewer available days than this in the window and nothing fires. */
export const ANOMALY_MIN_HISTORY_DAYS = 7;
/** The day must be at least this many times the usual (median) amount. */
export const ANOMALY_MIN_RATIO = 2;
/** Modified z-score cutoff (Iglewicz and Hoaglin): a day must score above it. */
export const ANOMALY_SCORE_CUTOFF = 3.5;
/** Money: the day must be at least this many whole currency units above the usual amount. */
export const ANOMALY_MIN_MONEY_CHANGE_MAJOR = 5;
/** Quantities: the day must be at least this much above the usual amount, per unit. */
const MIN_QUANTITY_CHANGE: Readonly<Record<string, number>> = { GB: 1, MB: 1000 };
export const ANOMALY_MIN_QUANTITY_CHANGE_DEFAULT = 50;

const DAY_MS = 86_400_000;
// 0.6745 is the 0.75 quantile of the standard normal, which scales the median absolute deviation
// to the standard deviation of normally distributed data.
const MAD_SCALE = 0.6745;

export type AnomalySource = "verified" | "estimated";

/** How a series' rows become daily amounts. */
export type Accrual = "daily" | "period_to_date";

export type AnomalyRow = Pick<
  SnapshotInput,
  | "connection_id"
  | "external_account_id"
  | "metric_key"
  | "kind"
  | "label"
  | "snapshot_date"
  | "value"
  | "unit"
  | "amount_minor"
  | "currency"
  | "period_start"
  | "period_end"
  | "point_at"
  | "retrieved_at"
  | "provenance_source"
>;

export type AnomalyConnection = Readonly<{ id: string; provider: ProviderId }>;

export type AnomalyMute = Readonly<{ provider: ProviderId; metric_key: string }>;

export type Spike = Readonly<{
  /** The checked day's amount (minor units for money). */
  value: number;
  /** The median of the available days in the window. */
  usual: number;
  /** value / usual; null when the usual amount is zero. */
  ratio: number | null;
  /** How many days of the window had an amount. */
  historyDays: number;
}>;

export type Anomaly = Spike &
  Readonly<{
    date: string;
    provider: ProviderId;
    metricKey: string;
    label: string;
    measure: TrendMeasure;
    source: AnomalySource;
    accrual: Accrual;
    /** The one connection and account behind the series, when there is exactly one. */
    connectionId: string | null;
    externalAccountId: string | null;
  }>;

export function addUtcDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The first and last snapshot dates detection for `date` needs. */
export function anomalySnapshotRange(date: string): Readonly<{ from: string; to: string }> {
  // One day before the window, for the first running total difference; one day after the checked
  // day, because a provider reports a whole day's amount (a one day period) the day after.
  return { from: addUtcDays(date, -ANOMALY_WINDOW_DAYS - 1), to: addUtcDays(date, 1) };
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/** The smallest rise above the usual amount that may fire, in the measure's own units. */
export function minimumChange(measure: TrendMeasure): number {
  if (measure.type === "money") return ANOMALY_MIN_MONEY_CHANGE_MAJOR * 10 ** currencyMinorDigits(measure.currency);
  return MIN_QUANTITY_CHANGE[measure.unit] ?? ANOMALY_MIN_QUANTITY_CHANGE_DEFAULT;
}

/**
 * The checked day against the days before it, or null when it is not unusual or there is not
 * enough history. `history` holds the window's daily amounts, null where unavailable.
 */
export function detectSpike(history: readonly (number | null)[], value: number | null, measure: TrendMeasure): Spike | null {
  if (value === null) return null;
  const available = history.filter((amount): amount is number => amount !== null).sort((a, b) => a - b);
  if (available.length < ANOMALY_MIN_HISTORY_DAYS) return null;
  const usual = median(available);
  if (value - usual < minimumChange(measure)) return null;
  if (value < ANOMALY_MIN_RATIO * usual) return null;
  const deviation = median(available.map((amount) => Math.abs(amount - usual)).sort((a, b) => a - b));
  // A flat history has no spread: anything past the ratio and the minimum change is unusual.
  if (deviation > 0 && (MAD_SCALE * (value - usual)) / deviation <= ANOMALY_SCORE_CUTOFF) return null;
  return { value, usual, ratio: usual > 0 ? value / usual : null, historyDays: available.length };
}

// ── Daily amounts ───────────────────────────────────────────────────────────────────────────────

function measureOf(row: AnomalyRow): TrendMeasure | null {
  if (row.currency !== null && row.amount_minor !== null) return { type: "money", currency: row.currency };
  if (row.unit !== null && row.value !== null) return { type: "quantity", unit: row.unit };
  return null;
}

function amountOf(row: AnomalyRow): number {
  return (row.amount_minor ?? row.value) ?? 0;
}

function measureKey(measure: TrendMeasure): string {
  return measure.type === "money" ? `money:${measure.currency}` : `quantity:${measure.unit}`;
}

/** True for a spend or usage row over a period that starts on a UTC day boundary. */
function isDailyCandidate(row: AnomalyRow): boolean {
  if (row.kind !== "verified_spend" && row.kind !== "estimated_spend" && row.kind !== "usage") return false;
  return row.period_start !== null && row.period_end !== null && Date.parse(row.period_start) % DAY_MS === 0;
}

function isLongerThanADay(row: AnomalyRow): boolean {
  return row.period_start !== null && row.period_end !== null && Date.parse(row.period_end) - Date.parse(row.period_start) > DAY_MS;
}

/**
 * Drops breakdowns that sit beside their total: `<prefix>.total`, or the parent key itself, for
 * the same account, kind, and currency or unit.
 */
function dropBreakdowns(rows: readonly AnomalyRow[]): AnomalyRow[] {
  const groupOf = (row: AnomalyRow, key: string) => `${row.external_account_id} ${row.kind} ${row.currency ?? row.unit ?? ""} ${key}`;
  const present = new Set(rows.map((row) => groupOf(row, row.metric_key)));
  return rows.filter((row) => {
    if (row.metric_key.endsWith(".total")) return true;
    const parent = row.metric_key.slice(0, row.metric_key.lastIndexOf("."));
    return !present.has(groupOf(row, parent)) && !present.has(groupOf(row, `${parent}.total`));
  });
}

type Cell = {
  accrual: Accrual;
  /** Snapshot date (running totals) or period day (daily periods) to that day's newest row. */
  rows: Map<string, AnomalyRow>;
};

/**
 * One account's rows of one series, keyed by the day they describe. A running total's period is
 * one day long on its first day (month to date on the 1st), so an account counts as daily only
 * when none of its rows covers more than a day.
 */
function toCell(rows: readonly AnomalyRow[]): Cell {
  const accrual: Accrual = rows.some(isLongerThanADay) ? "period_to_date" : "daily";
  const byDay = new Map<string, AnomalyRow>();
  for (const row of rows) {
    const day = accrual === "daily" && row.period_start !== null ? new Date(row.period_start).toISOString().slice(0, 10) : row.snapshot_date;
    const current = byDay.get(day);
    if (current === undefined || newer(row, current)) byDay.set(day, row);
  }
  return { accrual, rows: byDay };
}

function newer(a: AnomalyRow, b: AnomalyRow): boolean {
  return a.snapshot_date > b.snapshot_date || (a.snapshot_date === b.snapshot_date && Date.parse(a.retrieved_at) > Date.parse(b.retrieved_at));
}

/** One account's amount for `day`, or null when it cannot be told honestly. */
function cellAmount(cell: Cell, day: string): number | null {
  const row = cell.rows.get(day);
  if (row === undefined) return null;
  if (cell.accrual === "daily") return amountOf(row);
  if (row.period_start === null) return null;
  const periodStart = Date.parse(row.period_start);
  if (new Date(periodStart).toISOString().slice(0, 10) === day) return null;
  const samePeriod = (other: AnomalyRow | undefined): other is AnomalyRow =>
    other?.period_start != null && Date.parse(other.period_start) === periodStart;
  const previous = cell.rows.get(addUtcDays(day, -1));
  if (!samePeriod(previous)) return null;
  // A reading below the one before it was a correction or a glitch, so it is no baseline either.
  const before = cell.rows.get(addUtcDays(day, -2));
  if (samePeriod(before) && amountOf(previous) < amountOf(before)) return null;
  const amount = amountOf(row) - amountOf(previous);
  return amount < 0 ? null : amount;
}

type Series = {
  provider: ProviderId;
  metricKey: string;
  measure: TrendMeasure;
  source: AnomalySource;
  latest: AnomalyRow;
  /** External account id to that account's rows. */
  accounts: Map<string, AnomalyRow[]>;
  connectionIds: Set<string>;
};

function buildSeries(rows: readonly AnomalyRow[], connections: readonly AnomalyConnection[]): Series[] {
  const providers = new Map(connections.map((connection) => [connection.id, connection.provider]));
  const series = new Map<string, Series>();
  for (const row of dropBreakdowns(rows)) {
    const provider = providers.get(row.connection_id);
    const measure = measureOf(row);
    if (provider === undefined || measure === null || !isDailyCandidate(row)) continue;
    const source: AnomalySource = isEstimated(row) ? "estimated" : "verified";
    const key = `${provider} ${row.metric_key} ${measureKey(measure)} ${source}`;
    let entry = series.get(key);
    if (entry === undefined) {
      entry = { provider, metricKey: row.metric_key, measure, source, latest: row, accounts: new Map(), connectionIds: new Set() };
      series.set(key, entry);
    }
    if (newer(row, entry.latest)) entry.latest = row;
    entry.connectionIds.add(row.connection_id);
    const accountRows = entry.accounts.get(row.external_account_id);
    if (accountRows === undefined) entry.accounts.set(row.external_account_id, [row]);
    else accountRows.push(row);
  }
  return [...series.values()];
}

/** The series' amount for each of `days`: summed over accounts, null where any expected one is missing. */
function seriesAmounts(cells: readonly Cell[], days: readonly string[]): (number | null)[] {
  const firstDays = cells.map((cell) => [...cell.rows.keys()].sort()[0] ?? "");
  return days.map((day) => {
    let total = 0;
    let expected = 0;
    for (const [index, cell] of cells.entries()) {
      if ((firstDays[index] ?? "") > day) continue;
      expected += 1;
      const amount = cellAmount(cell, day);
      if (amount === null) return null;
      total += amount;
    }
    return expected === 0 ? null : total;
  });
}

/**
 * Every unusual series on `date` (`YYYY-MM-DD`, UTC), from rows narrowed to the workspace and to
 * `anomalySnapshotRange(date)`. Rows of connections not listed are ignored, and so are muted
 * metrics. Sorted by provider name, then label.
 */
export function findAnomalies(input: {
  date: string;
  rows: readonly AnomalyRow[];
  connections: readonly AnomalyConnection[];
  mutes: readonly AnomalyMute[];
}): Anomaly[] {
  const muted = new Set(input.mutes.map((mute) => `${mute.provider} ${mute.metric_key}`));
  const days = Array.from({ length: ANOMALY_WINDOW_DAYS + 1 }, (_, index) => addUtcDays(input.date, index - ANOMALY_WINDOW_DAYS));
  const anomalies: Anomaly[] = [];
  for (const series of buildSeries(input.rows, input.connections)) {
    if (muted.has(`${series.provider} ${series.metricKey}`)) continue;
    const cells = [...series.accounts.values()].map(toCell);
    const amounts = seriesAmounts(cells, days);
    const spike = detectSpike(amounts.slice(0, -1), amounts.at(-1) ?? null, series.measure);
    if (spike === null) continue;
    anomalies.push({
      ...spike,
      // Money is shown in minor units; a median of two middle days can fall between two of them.
      usual: series.measure.type === "money" ? Math.round(spike.usual) : spike.usual,
      date: input.date,
      provider: series.provider,
      metricKey: series.metricKey,
      label: series.latest.label,
      measure: series.measure,
      source: series.source,
      accrual: cells.some((cell) => cell.accrual === "period_to_date") ? "period_to_date" : "daily",
      connectionId: series.connectionIds.size === 1 ? ([...series.connectionIds][0] ?? null) : null,
      externalAccountId: series.accounts.size === 1 ? ([...series.accounts.keys()][0] ?? null) : null,
    });
  }
  return anomalies.sort(
    (a, b) => providerName(a.provider).localeCompare(providerName(b.provider)) || a.label.localeCompare(b.label) || a.source.localeCompare(b.source),
  );
}

// ── Copy ────────────────────────────────────────────────────────────────────────────────────────

/** "4 times the usual daily spend", "2.5 times the usual daily usage", or "up from a usual $0.00 a day". */
export function unusualWords(anomaly: Pick<Anomaly, "ratio" | "usual" | "measure">): string {
  const noun = anomaly.measure.type === "money" ? "spend" : "usage";
  if (anomaly.ratio === null) return `up from a usual ${formatTrendValue(anomaly.usual, anomaly.measure)} a day`;
  const ratio = anomaly.ratio >= 10 ? Math.round(anomaly.ratio) : Math.round(anomaly.ratio * 10) / 10;
  return `${ratio} times the usual daily ${noun}`;
}

export function anomalyEventKey(anomaly: Pick<Anomaly, "date" | "provider" | "metricKey" | "measure" | "source">): string {
  return `anomaly:${anomaly.date}:${anomaly.provider}:${anomaly.metricKey}:${measureKey(anomaly.measure)}:${anomaly.source}`;
}

/** One `devmacro.anomaly_detected` timeline event, deduplicated per metric per day. */
export function anomalyEvent(workspaceId: string, anomaly: Anomaly): TablesInsert<"activity_events"> {
  const provider = providerName(anomaly.provider);
  const noun = anomaly.measure.type === "money" ? "spend" : "usage";
  const value = formatTrendValue(anomaly.value, anomaly.measure);
  const usual = formatTrendValue(anomaly.usual, anomaly.measure);
  const amount = anomaly.accrual === "period_to_date" ? `went up by ${value}` : `was ${value}`;
  return {
    workspace_id: workspaceId,
    connection_id: anomaly.connectionId,
    external_account_id: anomaly.externalAccountId,
    provider: anomaly.provider,
    type_id: ANOMALY_TYPE_ID,
    severity: "warning",
    title: `Unusual ${noun} on ${provider}: ${unusualWords(anomaly)}`,
    body: [
      `${anomaly.label} (${anomaly.source}) ${amount} on ${anomaly.date}. The usual amount is ${usual} a day, the median of the ${anomaly.historyDays} days before.`,
      `What to do next: open ${provider} to see what drove it, check the timeline for deploys on ${anomaly.date}, or mute this metric on the Alerts page if it was expected.`,
    ].join("\n"),
    url: null,
    // The end of the checked day, beside the daily summary for the same day.
    occurred_at: new Date(Date.parse(`${anomaly.date}T00:00:00.000Z`) + DAY_MS).toISOString(),
    dedupe_key: anomalyEventKey(anomaly),
  };
}
