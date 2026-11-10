import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACKNOWLEDGE_ALL_LIMIT, acknowledgeAllTriggeredAlerts } from "./triggered-alerts";

/*
 * "Acknowledge all" (#268) against an in-memory `triggered_alerts` table that applies the filters,
 * order, limit, and update the data layer asks for, so the tests check which rows end up
 * acknowledged rather than which builder methods were called.
 */

type AlertRow = {
  id: string;
  workspace_id: string;
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};
type Column = keyof AlertRow;
type Result = { data: Array<{ id: string }>; error: null };

const db = vi.hoisted(() => ({
  rows: [] as AlertRow[],
  updates: 0,
  /** Runs once, between the read and the update: another member acknowledging at the same time. */
  beforeUpdate: null as (() => void) | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      if (table !== "triggered_alerts") throw new Error(`Unexpected table ${table}`);
      const filters: Array<(row: AlertRow) => boolean> = [];
      let patch: Partial<AlertRow> | null = null;
      let limit = Number.POSITIVE_INFINITY;
      const builder = {
        select: () => builder,
        update(values: Partial<AlertRow>) {
          patch = values;
          return builder;
        },
        eq(column: Column, value: string) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        is(column: Column, value: null) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column: Column, values: readonly string[]) {
          filters.push((row) => values.includes(String(row[column])));
          return builder;
        },
        order: () => builder,
        limit(count: number) {
          limit = count;
          return builder;
        },
        then(resolve: (value: Result) => unknown) {
          if (patch !== null) {
            db.beforeUpdate?.();
            db.beforeUpdate = null;
            db.updates += 1;
          }
          const matched = db.rows
            .filter((row) => filters.every((keep) => keep(row)))
            .sort((a, b) => b.triggered_at.localeCompare(a.triggered_at) || b.id.localeCompare(a.id))
            .slice(0, limit);
          if (patch !== null) for (const row of matched) Object.assign(row, patch);
          return Promise.resolve({ data: matched.map(({ id }) => ({ id })), error: null }).then(resolve);
        },
      };
      return builder;
    },
  }),
}));

const WORKSPACE = "26800000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE = "26800000-0000-4000-8000-000000000002";
const USER = "26800000-0000-4000-8000-0000000000aa";
const OTHER_USER = "26800000-0000-4000-8000-0000000000bb";

/** `count` unacknowledged alerts in `workspaceId`, one a minute from 2026-11-01 00:00 UTC. */
function alerts(workspaceId: string, count: number, prefix = "a"): AlertRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index).padStart(4, "0")}`,
    workspace_id: workspaceId,
    triggered_at: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
    acknowledged_at: null,
    acknowledged_by: null,
  }));
}

function acknowledgedIds(workspaceId: string): string[] {
  return db.rows
    .filter((row) => row.workspace_id === workspaceId && row.acknowledged_by === USER)
    .map((row) => row.id)
    .sort();
}

beforeEach(() => {
  db.rows = [];
  db.updates = 0;
  db.beforeUpdate = null;
});

describe("acknowledgeAllTriggeredAlerts", () => {
  it("returns 0 and writes nothing when the workspace has no unacknowledged alerts", async () => {
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(0);
    expect(db.updates).toBe(0);
  });

  it("acknowledges every unacknowledged alert in the user's name and returns how many", async () => {
    db.rows = alerts(WORKSPACE, 6);
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(6);
    expect(acknowledgedIds(WORKSPACE)).toHaveLength(6);
    for (const row of db.rows) expect(row.acknowledged_at).not.toBeNull();
  });

  it(`acknowledges only the newest ${ACKNOWLEDGE_ALL_LIMIT} when more are waiting`, async () => {
    db.rows = alerts(WORKSPACE, ACKNOWLEDGE_ALL_LIMIT + 50);
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(ACKNOWLEDGE_ALL_LIMIT);
    const newest = alerts(WORKSPACE, ACKNOWLEDGE_ALL_LIMIT + 50)
      .slice(50)
      .map((row) => row.id);
    expect(acknowledgedIds(WORKSPACE)).toEqual(newest.sort());
    // The next call picks up the rest.
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(50);
  });

  it("never reads or writes another workspace's alerts", async () => {
    db.rows = alerts(OTHER_WORKSPACE, 3, "other");
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(0);
    expect(db.rows.every((row) => row.acknowledged_at === null)).toBe(true);

    db.rows.push(...alerts(WORKSPACE, 2));
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(2);
    expect(db.rows.filter((row) => row.workspace_id === OTHER_WORKSPACE).every((row) => row.acknowledged_at === null)).toBe(
      true,
    );
  });

  it("keeps an earlier acknowledgement and does not count it", async () => {
    const [earlier, ...rest] = alerts(WORKSPACE, 3);
    if (earlier === undefined) throw new Error("No alert to acknowledge first");
    db.rows = [{ ...earlier, acknowledged_at: "2026-11-02T08:00:00.000Z", acknowledged_by: OTHER_USER }, ...rest];
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(2);
    expect(db.rows.find((row) => row.id === earlier.id)).toMatchObject({
      acknowledged_at: "2026-11-02T08:00:00.000Z",
      acknowledged_by: OTHER_USER,
    });
  });

  it("does not count an alert another member acknowledged between the read and the update", async () => {
    db.rows = alerts(WORKSPACE, 3);
    db.beforeUpdate = () => {
      const first = db.rows[0];
      if (first !== undefined) Object.assign(first, { acknowledged_at: "2026-11-02T08:00:00.000Z", acknowledged_by: OTHER_USER });
    };
    expect(await acknowledgeAllTriggeredAlerts(WORKSPACE, USER)).toBe(2);
    expect(db.rows[0]?.acknowledged_by).toBe(OTHER_USER);
  });
});
