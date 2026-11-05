import type { ConnectionStatus } from "@/lib/dashboard/aggregate";

import type { PublicMetricStore, SnapshotPoint, SourceAccount, StoredEvent } from "./engine";
import type { HistoryEvent, HistoryStore } from "./history";

/**
 * In-memory `PublicMetricStore` for unit tests, with the same filters as the Supabase store:
 * accounts of revoked connections left out, inclusive snapshot dates, `from <= occurred_at < to`
 * for counts, `occurred_at <= before` for recent events and event pages, newest first. An event's
 * id for `eventPage` is its position in the constructor's list.
 */
export type MemoryEvent = StoredEvent & Readonly<{ accountId: string }>;
/** An account with its connection's status; active when not given. */
export type MemoryAccount = SourceAccount & Readonly<{ connectionStatus?: ConnectionStatus }>;

export class MemoryMetricStore implements HistoryStore {
  constructor(
    private readonly sourceAccounts: readonly MemoryAccount[],
    private readonly points: readonly SnapshotPoint[],
    private readonly events: readonly MemoryEvent[],
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

  async eventPage({ accountIds, typeIds, before, offset, limit }: Parameters<HistoryStore["eventPage"]>[0]): Promise<HistoryEvent[]> {
    return this.events
      .map((event, index) => ({ ...event, id: String(index) }))
      .filter((event) => accountIds.includes(event.accountId) && typeIds.includes(event.typeId) && event.occurredAt.getTime() <= before.getTime())
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || Number(b.id) - Number(a.id))
      .slice(offset, offset + limit);
  }
}
