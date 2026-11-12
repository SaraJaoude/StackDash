import type { ProviderId } from "@/lib/adapters/types";
import type { ConnectionStatus } from "@/lib/dashboard/aggregate";
import { londonDate } from "@/lib/timeline/days";

import type { PublicMetricStore, SnapshotPoint, SourceAccount, StoredEvent } from "./engine";
import type { HistoryEvent, HistoryStore } from "./history";
import type { EventActivity, YearReviewStore } from "./yearly";

/** An account with its connection's status; active when not given. */
export type MemoryAccount = SourceAccount & Readonly<{ connectionStatus?: ConnectionStatus }>;

/**
 * In-memory `HistoryStore` and `YearReviewStore`, with the same filters as the Supabase store:
 * accounts of revoked connections left out, inclusive snapshot dates, `from <= occurred_at < to`
 * for counts and the year in review, `since <= occurred_at <= before` for recent events,
 * `occurred_at <= before` for event pages, newest first. An event's id for `eventPage` is its
 * position in the constructor's list, and its provider is its account's. Unit tests use it, and a
 * card's trend computes its points against one built from rows read once (trend.ts).
 */
export class MemoryMetricStore implements HistoryStore, YearReviewStore {
  constructor(
    private readonly sourceAccounts: readonly MemoryAccount[],
    private readonly points: readonly SnapshotPoint[],
    private readonly events: readonly StoredEvent[],
  ) {}

  async accounts(): Promise<readonly SourceAccount[]> {
    return this.sourceAccounts.flatMap(({ connectionStatus, ...account }) => (connectionStatus === "revoked" ? [] : [account]));
  }

  async snapshots({ accountIds, metricKeys, fromDate, toDate }: Parameters<PublicMetricStore["snapshots"]>[0]) {
    return this.points.filter(
      (point) =>
        accountIds.includes(point.accountId) &&
        metricKeys.includes(point.metricKey) &&
        point.snapshotDate >= fromDate &&
        point.snapshotDate <= toDate,
    );
  }

  async earliestSnapshotDate({ accountIds, metricKey }: Parameters<PublicMetricStore["earliestSnapshotDate"]>[0]) {
    let earliest: string | null = null;
    for (const point of this.points) {
      if (!accountIds.includes(point.accountId) || point.metricKey !== metricKey) continue;
      if (earliest === null || point.snapshotDate < earliest) earliest = point.snapshotDate;
    }
    return earliest;
  }

  private matching(accountIds: readonly string[], typeIds: readonly string[]): StoredEvent[] {
    return this.events.filter((event) => accountIds.includes(event.accountId) && typeIds.includes(event.typeId));
  }

  async countEvents({ accountIds, typeIds, from, to }: Parameters<PublicMetricStore["countEvents"]>[0]) {
    return this.matching(accountIds, typeIds).filter(
      (event) => event.occurredAt.getTime() >= from.getTime() && event.occurredAt.getTime() < to.getTime(),
    ).length;
  }

  async earliestEvent({ accountIds, typeIds }: Parameters<PublicMetricStore["earliestEvent"]>[0]) {
    let earliest: Date | null = null;
    for (const event of this.matching(accountIds, typeIds)) {
      if (earliest === null || event.occurredAt.getTime() < earliest.getTime()) earliest = event.occurredAt;
    }
    return earliest;
  }

  async recentEvents({ accountIds, typeIds, since, before, limit }: Parameters<PublicMetricStore["recentEvents"]>[0]) {
    return this.matching(accountIds, typeIds)
      .filter((event) => event.occurredAt.getTime() <= before.getTime() && (since === undefined || event.occurredAt.getTime() >= since.getTime()))
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }

  async eventPage({ accountIds, typeIds, before, offset, limit }: Parameters<HistoryStore["eventPage"]>[0]): Promise<HistoryEvent[]> {
    return this.events
      .map((event, index) => ({ ...event, id: String(index) }))
      .filter((event) => accountIds.includes(event.accountId) && typeIds.includes(event.typeId) && event.occurredAt.getTime() <= before.getTime())
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || Number(b.id) - Number(a.id))
      .slice(offset, offset + limit);
  }

  private inWindow(accountIds: readonly string[], typeIds: readonly string[] | null, from: Date, to: Date): StoredEvent[] {
    return this.events.filter(
      (event) =>
        accountIds.includes(event.accountId) &&
        (typeIds === null || typeIds.includes(event.typeId)) &&
        event.occurredAt.getTime() >= from.getTime() &&
        event.occurredAt.getTime() < to.getTime(),
    );
  }

  // The rules of year_review_event_counts (20261111120000_year_review_slides.sql).
  async eventActivity({ accountIds, excludedTypeIds, from, to }: Parameters<YearReviewStore["eventActivity"]>[0]): Promise<EventActivity> {
    const providerOf = new Map(this.sourceAccounts.map((account) => [account.accountId, account.provider]));
    const days = new Map<string, number>();
    const providers = new Map<ProviderId, number>();
    for (const event of this.inWindow(accountIds, null, from, to)) {
      if (excludedTypeIds.includes(event.typeId)) continue;
      const day = londonDate(event.occurredAt);
      days.set(day, (days.get(day) ?? 0) + 1);
      const provider = providerOf.get(event.accountId);
      if (provider !== undefined) providers.set(provider, (providers.get(provider) ?? 0) + 1);
    }
    return {
      days: [...days].map(([day, events]) => ({ day, events })),
      providers: [...providers].map(([provider, events]) => ({ provider, events })),
    };
  }

  // The rules of year_review_longest_run: oldest first, a failure first at a shared instant.
  async longestRun({ accountIds, successTypeId, failureTypeId, from, to }: Parameters<YearReviewStore["longestRun"]>[0]): Promise<number> {
    const failed = (event: StoredEvent) => (event.typeId === failureTypeId ? 1 : 0);
    const outcomes = this.inWindow(accountIds, [successTypeId, failureTypeId], from, to).sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || failed(b) - failed(a),
    );
    let longest = 0;
    let current = 0;
    for (const event of outcomes) {
      current = failed(event) === 1 ? 0 : current + 1;
      longest = Math.max(longest, current);
    }
    return longest;
  }
}
