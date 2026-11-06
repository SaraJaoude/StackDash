import { publicMetricDefinition, type PublicMetricId } from "./definitions";
import {
  computePublicMetrics,
  snapshotsWholeFrom,
  STALE_AFTER_MS,
  type ComputedMetric,
  type PublicMetricStore,
  type SnapshotPoint,
  type StoredEvent,
} from "./engine";
import { MemoryMetricStore } from "./memory-store";

/*
 * One metric at many moments, for a card's trend (#149), at a constant number of queries whatever
 * the number of moments: the accounts, one read of the snapshots or the events that cover every
 * moment's window, and for an event count the oldest stored event. The engine then computes each
 * moment against those rows in memory (MemoryMetricStore), with the same formulas and filters as a
 * published value.
 *
 * - The oldest stored event, which decides "not enough history" for an event count, is asked of
 *   the database once and shared by every moment, so it means what it means for the published
 *   value, not "the oldest event in the rows read".
 * - The event read is one request of TREND_EVENTS_LIMIT rows, newest first. When it is cut, rows
 *   at or before its oldest event may be missing, so a moment that needs them has no value rather
 *   than an understated one.
 * - The snapshot read is one store read, newest first. When the store stopped it at
 *   SNAPSHOT_READ_MAX_ROWS (engine.ts), its oldest day may be missing rows, so a moment whose
 *   window reaches that day has no value rather than one summed over some of the accounts (#209).
 *
 * Pure apart from the injected store, so it is unit tested against the in-memory store.
 */

/**
 * Most events read for one trend. PostgREST returns at most 1000 rows per request
 * (supabase/config.toml max_rows, also the Supabase hosted default) and cuts a longer read without
 * an error, so a larger limit would never be reached and a cut read would pass as complete. At
 * the cap, a full read is treated as possibly cut, and a busy project gets no point rather than a
 * smaller one.
 */
export const TREND_EVENTS_LIMIT = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

type SharedReads = Readonly<{
  store: PublicMetricStore;
  rows: MemoryMetricStore;
  /** The oldest event of the event read when it was cut at TREND_EVENTS_LIMIT, else null. */
  cutAt: Date | null;
  /** The first day the snapshot read holds in full when it was cut, else null. */
  snapshotsFrom: string | null;
  /** Reads that are the same at every moment, asked of `store` once. */
  earliestEvents: Map<string, Promise<Date | null>>;
  earliestSnapshotDates: Map<string, Promise<string | null>>;
}>;

function readOnce<T>(cache: Map<string, Promise<T>>, query: object, read: () => Promise<T>): Promise<T> {
  const key = JSON.stringify(query);
  const pending = cache.get(key) ?? read();
  cache.set(key, pending);
  return pending;
}

/** The shared rows, for one moment; `covered` turns false when it needed rows a cut read lost. */
class MomentStore implements PublicMetricStore {
  covered = true;

  constructor(private readonly shared: SharedReads) {}

  accounts() {
    return this.shared.rows.accounts();
  }

  snapshots(query: Parameters<PublicMetricStore["snapshots"]>[0]) {
    const { snapshotsFrom } = this.shared;
    if (snapshotsFrom !== null && query.fromDate < snapshotsFrom) this.covered = false;
    return this.shared.rows.snapshots(query);
  }

  earliestSnapshotDate(query: Parameters<PublicMetricStore["earliestSnapshotDate"]>[0]) {
    return readOnce(this.shared.earliestSnapshotDates, query, () => this.shared.store.earliestSnapshotDate(query));
  }

  earliestEvent(query: Parameters<PublicMetricStore["earliestEvent"]>[0]) {
    return readOnce(this.shared.earliestEvents, query, () => this.shared.store.earliestEvent(query));
  }

  countEvents(query: Parameters<PublicMetricStore["countEvents"]>[0]) {
    const { cutAt } = this.shared;
    if (cutAt !== null && query.from.getTime() <= cutAt.getTime()) this.covered = false;
    return this.shared.rows.countEvents(query);
  }

  async recentEvents(query: Parameters<PublicMetricStore["recentEvents"]>[0]) {
    const events = await this.shared.rows.recentEvents(query);
    // Fewer than asked for: older events the query wanted exist only if the read was cut before them.
    const { cutAt } = this.shared;
    if (cutAt !== null && events.length < query.limit && (query.since === undefined || query.since.getTime() <= cutAt.getTime())) {
      this.covered = false;
    }
    return events;
  }
}

/** `metricId` computed at each of `moments`, in order; null where a cut read cannot tell. */
export async function computeTrend(store: PublicMetricStore, metricId: PublicMetricId, moments: readonly Date[]): Promise<(ComputedMetric | null)[]> {
  if (moments.length === 0) return [];
  const first = Math.min(...moments.map((moment) => moment.getTime()));
  const last = new Date(Math.max(...moments.map((moment) => moment.getTime())));
  const definition = publicMetricDefinition(metricId);
  const accounts = await store.accounts();
  const accountIds = accounts.filter((account) => account.provider === definition.provider).map((account) => account.accountId);
  // Where the oldest moment's window starts.
  const windowStart = new Date(first - definition.windowDays * DAY_MS);

  let points: readonly SnapshotPoint[] = [];
  let events: readonly StoredEvent[] = [];
  const { source } = definition;
  switch (source.type) {
    case "snapshot_total":
    case "snapshot_change":
    case "snapshot_percent":
      points = await store.snapshots({
        accountIds,
        metricKeys: source.type === "snapshot_percent" ? [source.numeratorKey, source.denominatorKey] : [source.metricKey],
        // The window's start day, and the two days before the oldest moment a current reading may come from.
        fromDate: new Date(Math.min(windowStart.getTime(), first - STALE_AFTER_MS)).toISOString().slice(0, 10),
        toDate: last.toISOString().slice(0, 10),
      });
      break;
    case "event_count":
      events = await store.recentEvents({ accountIds, typeIds: source.typeIds, since: windowStart, before: last, limit: TREND_EVENTS_LIMIT });
      break;
    case "event_streak":
      // A streak counts back from each moment with no window, so this read has no lower bound.
      events = await store.recentEvents({ accountIds, typeIds: [source.successTypeId, source.failureTypeId], before: last, limit: TREND_EVENTS_LIMIT });
      break;
  }

  const shared: SharedReads = {
    store,
    rows: new MemoryMetricStore(accounts, points, events),
    cutAt: events.length >= TREND_EVENTS_LIMIT ? (events.at(-1)?.occurredAt ?? null) : null,
    snapshotsFrom: snapshotsWholeFrom(points),
    earliestEvents: new Map(),
    earliestSnapshotDates: new Map(),
  };
  return Promise.all(
    moments.map(async (asOf) => {
      const moment = new MomentStore(shared);
      const [computed] = await computePublicMetrics(moment, [{ metricId, asOf }]);
      return computed !== undefined && moment.covered ? computed : null;
    }),
  );
}
