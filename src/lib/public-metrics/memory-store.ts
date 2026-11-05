import type { ConnectionStatus } from "@/lib/dashboard/aggregate";

import type { PublicMetricStore, SnapshotPoint, SourceAccount, StoredEvent } from "./engine";

/** An account with its connection's status; active when not given. */
export type MemoryAccount = SourceAccount & Readonly<{ connectionStatus?: ConnectionStatus }>;

/**
 * In-memory `PublicMetricStore`, with the same filters as the Supabase store: accounts of revoked
 * connections left out, inclusive snapshot dates, `from <= occurred_at < to` for counts,
 * `since <= occurred_at <= before` for recent events, newest first. Unit tests use it, and a card's
 * trend computes its points against one built from rows read once (trend.ts).
 */
export class MemoryMetricStore implements PublicMetricStore {
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
}
