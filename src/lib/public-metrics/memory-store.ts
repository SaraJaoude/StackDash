import type { PublicMetricStore, SnapshotPoint, SourceAccount, StoredEvent } from "./engine";

/**
 * In-memory `PublicMetricStore` for unit tests, with the same filters as the Supabase store:
 * inclusive snapshot dates, `from <= occurred_at < to` for counts, `occurred_at <= before` for
 * recent events, newest first.
 */
export type MemoryEvent = StoredEvent & Readonly<{ accountId: string }>;

export class MemoryMetricStore implements PublicMetricStore {
  constructor(
    private readonly sourceAccounts: readonly SourceAccount[],
    private readonly points: readonly SnapshotPoint[],
    private readonly events: readonly MemoryEvent[],
  ) {}

  async accounts(): Promise<readonly SourceAccount[]> {
    return this.sourceAccounts;
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

  private matching(accountIds: readonly string[], typeIds: readonly string[]): MemoryEvent[] {
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

  async recentEvents({ accountIds, typeIds, before, limit }: Parameters<PublicMetricStore["recentEvents"]>[0]) {
    return this.matching(accountIds, typeIds)
      .filter((event) => event.occurredAt.getTime() <= before.getTime())
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }
}
