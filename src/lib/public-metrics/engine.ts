import type { ProviderId } from "@/lib/adapters/types";

import { publicMetricDefinition, type PublicMetricId } from "./definitions";

/*
 * Computes public metrics from stored data (#148). Pure apart from the injected store, so every
 * formula is unit tested against an in-memory store and production reads Supabase through
 * `createSupabaseMetricStore` with the same queries.
 *
 * Rules every formula follows, because a public number must never claim more than the data shows:
 * - Only rows retrieved or events that occurred at or before `asOf` count, so a delayed value never
 *   peeks at later data.
 * - A count needs history covering its whole window, otherwise it is "not enough history".
 * - A value whose newest data is older than `STALE_AFTER_MS` is "stale", not a number.
 * - Partial data understates (an account added mid-window adds only what it saw), never overstates.
 * - Nothing is counted twice. The engine never reads money, and every sum adds one metric key
 *   across accounts (each account's newest reading), so a breakdown or a shorter window of the same
 *   amount never meets its total. The dashboard's count-once rules (`countedSnapshots` in
 *   src/lib/dashboard/aggregate.ts) exist for adding many keys of money together; a future formula
 *   that adds several keys or any money must read through them instead.
 */

export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
/** Newest events read for a streak. A longer run is reported as at least this many. */
export const STREAK_EVENT_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One included external account of the project, with what the engine needs from its connection. */
export type SourceAccount = Readonly<{
  accountId: string;
  provider: ProviderId;
  connectionCreatedAt: Date;
  lastSyncedAt: Date | null;
  /** The connection was made by the provider simulator (#131), so its data is made up. */
  simulated: boolean;
}>;

/** One quantity row of `usage_snapshots`. Money kinds never reach the engine. */
export type SnapshotPoint = Readonly<{
  accountId: string;
  metricKey: string;
  /** UTC day, `YYYY-MM-DD`. */
  snapshotDate: string;
  value: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  resetsAt: Date | null;
  retrievedAt: Date;
}>;

export type StoredEvent = Readonly<{ typeId: string; occurredAt: Date }>;

/** Reads for one project. Implementations scope every query to the project's included accounts. */
export interface PublicMetricStore {
  accounts(): Promise<readonly SourceAccount[]>;
  /** Quantity snapshots of `metricKeys` with `fromDate <= snapshot_date <= toDate`. */
  snapshots(query: Readonly<{ accountIds: readonly string[]; metricKeys: readonly string[]; fromDate: string; toDate: string }>): Promise<readonly SnapshotPoint[]>;
  /** Events of `typeIds` with `from <= occurred_at < to`. */
  countEvents(query: Readonly<{ accountIds: readonly string[]; typeIds: readonly string[]; from: Date; to: Date }>): Promise<number>;
  /** The oldest stored event of `typeIds`, or null. */
  earliestEvent(query: Readonly<{ accountIds: readonly string[]; typeIds: readonly string[] }>): Promise<Date | null>;
  /** Up to `limit` events of `typeIds` with `occurred_at <= before`, newest first. */
  recentEvents(query: Readonly<{ accountIds: readonly string[]; typeIds: readonly string[]; before: Date; limit: number }>): Promise<readonly StoredEvent[]>;
}

/**
 * Why there is no number. `not_connected`: no included account of the metric's provider in the
 * project. `no_data`: connected, but nothing stored yet (or the provider does not report it for
 * this account). `not_enough_history`: stored data does not cover the window yet. `stale`: the
 * newest data is older than two days.
 */
export type UnavailableReason = "not_connected" | "no_data" | "not_enough_history" | "stale";

export type MetricValue =
  | Readonly<{
      status: "available";
      value: number;
      /** True when the true value may be higher: a streak longer than `STREAK_EVENT_LIMIT`. */
      lowerBound: boolean;
      /** The oldest of the sync times the value rests on, so the value is complete up to here. */
      lastSyncedAt: Date;
      simulated: boolean;
    }>
  | Readonly<{ status: "unavailable"; reason: UnavailableReason }>;

/**
 * One metric at `asOf`. `from` sets the window start for change and count sources instead of the
 * definition's `windowDays` (the yearly card #151 asks for stars gained since 1 January);
 * publications never pass it. It must be before `asOf`, and a source without a window (a current
 * total, a share, a streak) refuses it rather than return a number that ignores it.
 */
export type MetricRequest = Readonly<{ metricId: PublicMetricId; asOf: Date; from?: Date }>;

export type ComputedMetric = Readonly<{ metricId: PublicMetricId; asOf: Date; result: MetricValue }>;

const unavailable = (reason: UnavailableReason): MetricValue => ({ status: "unavailable", reason });

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function minDate(dates: readonly Date[]): Date {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

/** Still describes the moment `asOf`: inside its billing period, or before its reset time. */
function isCurrent(point: SnapshotPoint, asOf: Date): boolean {
  const at = asOf.getTime();
  if (point.periodStart !== null && point.periodEnd !== null) {
    if (at < point.periodStart.getTime() || at >= point.periodEnd.getTime()) return false;
  }
  return point.resetsAt === null || point.resetsAt.getTime() > at;
}

function isFresh(at: Date, asOf: Date): boolean {
  return asOf.getTime() - at.getTime() <= STALE_AFTER_MS;
}

/** Each account's newest reading of `metricKey` retrieved at or before `asOf`. */
function newestByAccount(points: readonly SnapshotPoint[], metricKey: string, asOf: Date): Map<string, SnapshotPoint> {
  const newest = new Map<string, SnapshotPoint>();
  for (const point of points) {
    if (point.metricKey !== metricKey || point.retrievedAt.getTime() > asOf.getTime()) continue;
    const seen = newest.get(point.accountId);
    if (seen === undefined || point.retrievedAt.getTime() > seen.retrievedAt.getTime()) newest.set(point.accountId, point);
  }
  return newest;
}

type Readings = { status: "ok"; readings: SnapshotPoint[] } | { status: "unavailable"; reason: UnavailableReason };

/** Newest current readings per account, or why there are none. */
function currentReadings(points: readonly SnapshotPoint[], metricKey: string, ctx: Context): Readings {
  const { asOf, accounts } = ctx;
  const newest = [...newestByAccount(points, metricKey, asOf).values()];
  // Nothing in the rows read. Rows older than those were read are stale, which the accounts' sync
  // times tell as they do for events; synced recently means the provider does not report the key.
  if (newest.length === 0) {
    const syncTimes = accountSyncTimes(accounts, asOf);
    return { status: "unavailable", reason: typeof syncTimes === "string" ? syncTimes : "no_data" };
  }
  const fresh = newest.filter((point) => isFresh(point.retrievedAt, asOf));
  if (fresh.length === 0) return { status: "unavailable", reason: "stale" };
  const current = fresh.filter((point) => isCurrent(point, asOf));
  // The newest reading belongs to a period that has ended and no sync has read the new one yet.
  if (current.length === 0) return { status: "unavailable", reason: "no_data" };
  return { status: "ok", readings: current };
}

function available(value: number, syncedAt: readonly Date[], accounts: readonly SourceAccount[], lowerBound = false): MetricValue {
  return {
    status: "available",
    value,
    lowerBound,
    lastSyncedAt: minDate(syncedAt),
    simulated: accounts.some((account) => account.simulated),
  };
}

type Context = Readonly<{
  store: PublicMetricStore;
  asOf: Date;
  /** Start of the window for change and count sources. */
  from: Date;
  accounts: readonly SourceAccount[];
}>;

async function snapshotTotal(ctx: Context, metricKey: string): Promise<MetricValue> {
  const { store, asOf, accounts } = ctx;
  const points = await store.snapshots({
    accountIds: accounts.map((account) => account.accountId),
    metricKeys: [metricKey],
    fromDate: utcDate(new Date(asOf.getTime() - STALE_AFTER_MS)),
    toDate: utcDate(asOf),
  });
  const readings = currentReadings(points, metricKey, ctx);
  if (readings.status === "unavailable") return unavailable(readings.reason);
  const used = accounts.filter((account) => readings.readings.some((point) => point.accountId === account.accountId));
  return available(
    readings.readings.reduce((sum, point) => sum + point.value, 0),
    readings.readings.map((point) => point.retrievedAt),
    used,
  );
}

async function snapshotPercent(ctx: Context, numeratorKey: string, denominatorKey: string): Promise<MetricValue> {
  const { store, asOf, accounts } = ctx;
  const points = await store.snapshots({
    accountIds: accounts.map((account) => account.accountId),
    metricKeys: [numeratorKey, denominatorKey],
    fromDate: utcDate(new Date(asOf.getTime() - STALE_AFTER_MS)),
    toDate: utcDate(asOf),
  });
  const numerators = currentReadings(points, numeratorKey, ctx);
  if (numerators.status === "unavailable") return unavailable(numerators.reason);
  const denominators = currentReadings(points, denominatorKey, ctx);
  if (denominators.status === "unavailable") return unavailable(denominators.reason);
  // Only accounts with both readings; one with no limit (a paid plan without a cap) has no share.
  const limits = new Map(denominators.readings.map((point) => [point.accountId, point]));
  const pairs = numerators.readings.flatMap((used) => {
    const limit = limits.get(used.accountId);
    return limit === undefined || limit.value <= 0 ? [] : [{ used, limit }];
  });
  if (pairs.length === 0) return unavailable("no_data");
  const usedTotal = pairs.reduce((sum, pair) => sum + pair.used.value, 0);
  const limitTotal = pairs.reduce((sum, pair) => sum + pair.limit.value, 0);
  return available(
    Math.floor((usedTotal / limitTotal) * 100),
    pairs.flatMap((pair) => [pair.used.retrievedAt, pair.limit.retrievedAt]),
    accounts.filter((account) => pairs.some((pair) => pair.used.accountId === account.accountId)),
  );
}

async function snapshotChange(ctx: Context, metricKey: string): Promise<MetricValue> {
  const { store, asOf, from, accounts } = ctx;
  const startDate = utcDate(from);
  // The window starts at the end of `startDate`, read from that day's row. A missing day may be
  // replaced by the next one (a shorter window, so an understatement), never by an earlier one.
  const nextDate = utcDate(new Date(Date.parse(`${startDate}T00:00:00Z`) + DAY_MS));
  // Two short reads, so a long window (a year for #151) never loads the days in between: the rows
  // of the start days, and the recent rows the newest reading comes from, as for a total.
  const accountIds = accounts.map((account) => account.accountId);
  const [baselines, recent] = await Promise.all([
    store.snapshots({ accountIds, metricKeys: [metricKey], fromDate: startDate, toDate: nextDate }),
    store.snapshots({
      accountIds,
      metricKeys: [metricKey],
      fromDate: utcDate(new Date(asOf.getTime() - STALE_AFTER_MS)),
      toDate: utcDate(asOf),
    }),
  ]);
  const readings = currentReadings(recent, metricKey, ctx);
  if (readings.status === "unavailable") return unavailable(readings.reason);

  const changes: { latest: SnapshotPoint; change: number }[] = [];
  for (const latest of readings.readings) {
    const baseline =
      baselines.find((point) => point.accountId === latest.accountId && point.snapshotDate === startDate) ??
      baselines.find((point) => point.accountId === latest.accountId && point.snapshotDate === nextDate);
    if (baseline === undefined || baseline.retrievedAt.getTime() >= latest.retrievedAt.getTime()) continue;
    changes.push({ latest, change: latest.value - baseline.value });
  }
  if (changes.length === 0) return unavailable("not_enough_history");
  return available(
    Math.max(0, changes.reduce((sum, entry) => sum + entry.change, 0)),
    changes.map((entry) => entry.latest.retrievedAt),
    accounts.filter((account) => changes.some((entry) => entry.latest.accountId === account.accountId)),
  );
}

/**
 * The accounts' sync times, or why their stored data cannot be trusted up to `asOf`: no data when
 * none has synced yet, stale when one has not synced for two days or has never synced beside one
 * that has (its data is missing).
 */
function accountSyncTimes(accounts: readonly SourceAccount[], asOf: Date): Date[] | UnavailableReason {
  const synced = accounts.map((account) => account.lastSyncedAt);
  if (synced.every((at) => at === null)) return "no_data";
  // One account never synced (or not for two days) means its events are missing from the count.
  const times = synced.filter((at): at is Date => at !== null);
  if (times.length < synced.length || !isFresh(minDate(times), asOf)) return "stale";
  return times;
}

async function eventCount(ctx: Context, typeIds: readonly string[]): Promise<MetricValue> {
  const { store, asOf, from, accounts } = ctx;
  const syncTimes = accountSyncTimes(accounts, asOf);
  if (typeof syncTimes === "string") return unavailable(syncTimes);
  const accountIds = accounts.map((account) => account.accountId);

  // History starts at the oldest connection or the oldest stored event, whichever is earlier
  // (adapters backfill some history on the first sync).
  const earliest = await store.earliestEvent({ accountIds, typeIds });
  const connected = minDate(accounts.map((account) => account.connectionCreatedAt));
  const historyStart = earliest === null ? connected : minDate([connected, earliest]);
  if (historyStart.getTime() > from.getTime()) return unavailable("not_enough_history");

  const count = await store.countEvents({ accountIds, typeIds, from, to: asOf });
  return available(count, syncTimes, accounts);
}

async function eventStreak(ctx: Context, successTypeId: string, failureTypeId: string): Promise<MetricValue> {
  const { store, asOf, accounts } = ctx;
  const syncTimes = accountSyncTimes(accounts, asOf);
  if (typeof syncTimes === "string") return unavailable(syncTimes);
  const events = await store.recentEvents({
    accountIds: accounts.map((account) => account.accountId),
    typeIds: [successTypeId, failureTypeId],
    before: asOf,
    limit: STREAK_EVENT_LIMIT,
  });
  const failureIndex = events.findIndex((event) => event.typeId === failureTypeId);
  const streak = failureIndex === -1 ? events.length : failureIndex;
  // Every event read succeeded and more may exist beyond the limit.
  const lowerBound = failureIndex === -1 && events.length >= STREAK_EVENT_LIMIT;
  return available(streak, syncTimes, accounts, lowerBound);
}

async function computeOne(store: PublicMetricStore, request: MetricRequest, all: readonly SourceAccount[]): Promise<ComputedMetric> {
  const definition = publicMetricDefinition(request.metricId);
  const { asOf } = request;
  if (request.from !== undefined) {
    if (definition.windowDays === 0) throw new RangeError(`${request.metricId} has no window, so it takes no from`);
    if (request.from.getTime() >= asOf.getTime()) throw new RangeError(`from must be before asOf for ${request.metricId}`);
  }
  const accounts = all.filter((account) => account.provider === definition.provider);
  const done = (result: MetricValue): ComputedMetric => ({ metricId: request.metricId, asOf, result });
  if (accounts.length === 0) return done(unavailable("not_connected"));

  const from = request.from ?? new Date(asOf.getTime() - definition.windowDays * DAY_MS);
  const ctx: Context = { store, asOf, from, accounts };
  const { source } = definition;
  switch (source.type) {
    case "snapshot_total":
      return done(await snapshotTotal(ctx, source.metricKey));
    case "snapshot_change":
      return done(await snapshotChange(ctx, source.metricKey));
    case "snapshot_percent":
      return done(await snapshotPercent(ctx, source.numeratorKey, source.denominatorKey));
    case "event_count":
      return done(await eventCount(ctx, source.typeIds));
    case "event_streak":
      return done(await eventStreak(ctx, source.successTypeId, source.failureTypeId));
  }
}

/**
 * Computes each requested metric for one project, in request order. The project's accounts are
 * read once; the metrics' own reads run in parallel.
 */
export async function computePublicMetrics(
  store: PublicMetricStore,
  requests: readonly MetricRequest[],
): Promise<ComputedMetric[]> {
  if (requests.length === 0) return [];
  const accounts = await store.accounts();
  return Promise.all(requests.map((request) => computeOne(store, request, accounts)));
}
