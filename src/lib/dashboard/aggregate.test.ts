import { describe, expect, it } from "vitest";

import {
  aggregateDashboard,
  dropSupersededBreakdowns,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPeriod,
  formatRelative,
  freshnessLabel,
  isCurrentPeriod,
  isStale,
  latestSnapshots,
  percentUsed,
  type AccountInput,
  type ConnectionInput,
  type DashboardInput,
  type ProjectInput,
  type SnapshotInput,
} from "./aggregate";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const MONTH = { period_start: "2026-10-01T00:00:00.000Z", period_end: "2026-11-01T00:00:00.000Z" } as const;
const HOUR = 3_600;

const connection: ConnectionInput = {
  id: "c1",
  provider: "fake",
  display_name: "Fake account",
  status: "active",
  last_synced_at: "2026-10-15T11:30:00.000Z",
  poll_interval_seconds: HOUR,
};

const accounts: AccountInput[] = [
  { id: "a1", connection_id: "c1", display_name: "Production", project_id: "p1" },
  { id: "a2", connection_id: "c1", display_name: "Staging", project_id: null },
];

const projects: ProjectInput[] = [{ id: "p1", name: "Checkout" }];

function money(
  overrides: Partial<SnapshotInput> & Pick<SnapshotInput, "metric_key" | "amount_minor" | "currency">,
): SnapshotInput {
  return {
    connection_id: "c1",
    external_account_id: "a1",
    kind: "verified_spend",
    label: "Spend this month",
    snapshot_date: "2026-10-15",
    value: null,
    unit: null,
    ...MONTH,
    point_at: null,
    resets_at: null,
    retrieved_at: "2026-10-15T11:30:00.000Z",
    provenance_source: "provider_api",
    pricing_source: null,
    ...overrides,
  };
}

function quantity(
  overrides: Partial<SnapshotInput> & Pick<SnapshotInput, "metric_key" | "kind" | "value" | "unit">,
): SnapshotInput {
  return {
    connection_id: "c1",
    external_account_id: "a1",
    label: "Requests",
    snapshot_date: "2026-10-15",
    amount_minor: null,
    currency: null,
    ...MONTH,
    point_at: null,
    resets_at: "2026-11-01T00:00:00.000Z",
    retrieved_at: "2026-10-15T11:30:00.000Z",
    provenance_source: "provider_api",
    pricing_source: null,
    ...overrides,
  };
}

function input(snapshots: SnapshotInput[], overrides: Partial<DashboardInput> = {}): DashboardInput {
  return { snapshots, connections: [connection], accounts, projects, provider: null, now: NOW, ...overrides };
}

describe("aggregateDashboard totals", () => {
  it("keeps two currencies apart and never adds them", () => {
    const view = aggregateDashboard(
      input([
        money({ metric_key: "fake.spend.usd", amount_minor: 12_345, currency: "USD" }),
        money({ metric_key: "fake.spend.eur", amount_minor: 6_789, currency: "EUR" }),
        money({ external_account_id: "a2", metric_key: "fake.spend.usd", amount_minor: 100, currency: "USD" }),
      ]),
    );
    expect(view.totals.map(({ currency, verified }) => [currency, verified?.amountMinor])).toEqual([
      ["EUR", 6_789],
      ["USD", 12_445],
    ]);
  });

  it("separates estimated from verified spend in the same currency", () => {
    const view = aggregateDashboard(
      input([
        money({ metric_key: "fake.spend.month", amount_minor: 1_000, currency: "USD" }),
        money({
          metric_key: "fake.cost.estimate",
          kind: "estimated_spend",
          amount_minor: 2_500,
          currency: "USD",
          provenance_source: "derived",
          pricing_source: "Fake price list 2026",
        }),
      ]),
    );
    expect(view.totals).toHaveLength(1);
    const [usd] = view.totals;
    expect(usd?.verified?.amountMinor).toBe(1_000);
    expect(usd?.verified?.provenance).toEqual({ status: "verified" });
    expect(usd?.estimated?.amountMinor).toBe(2_500);
    expect(usd?.estimated?.provenance).toEqual({ status: "estimated", pricingSources: ["Fake price list 2026"] });
  });

  it("reports a currency with only an estimate as having no verified amount, not zero", () => {
    const view = aggregateDashboard(
      input([
        money({
          metric_key: "fake.cost.estimate",
          kind: "estimated_spend",
          amount_minor: 2_500,
          currency: "USD",
          provenance_source: "derived",
          pricing_source: "Price list",
        }),
      ]),
    );
    expect(view.totals[0]?.verified).toBeNull();
  });

  it("uses only the latest snapshot per account and metric", () => {
    const view = aggregateDashboard(
      input([
        money({ metric_key: "fake.spend.month", amount_minor: 500, currency: "USD", snapshot_date: "2026-10-14" }),
        money({ metric_key: "fake.spend.month", amount_minor: 700, currency: "USD", snapshot_date: "2026-10-15" }),
      ]),
    );
    expect(view.totals[0]?.verified?.amountMinor).toBe(700);
  });

  it("ignores snapshots of accounts that are not included", () => {
    const view = aggregateDashboard(
      input([money({ external_account_id: "excluded", metric_key: "fake.spend.month", amount_minor: 1, currency: "USD" })]),
    );
    expect(view.totals).toEqual([]);
  });

  it("keeps revenue out of spending totals", () => {
    const view = aggregateDashboard(
      input([money({ metric_key: "fake.revenue.month", kind: "revenue", amount_minor: 9_000, currency: "USD" })]),
    );
    expect(view.totals).toEqual([]);
    expect(view.revenue[0]?.verified?.amountMinor).toBe(9_000);
  });

  it("narrows to one provider while still reporting that connections exist", () => {
    const view = aggregateDashboard(
      input([money({ metric_key: "fake.spend.month", amount_minor: 1, currency: "USD" })], { provider: "vercel" }),
    );
    expect(view.hasConnections).toBe(true);
    expect(view.byProvider).toEqual([]);
    expect(view.totals).toEqual([]);
    expect(view.providers).toEqual(["fake"]);
  });

  it("reports no connections for an empty workspace", () => {
    const view = aggregateDashboard(input([], { connections: [], accounts: [] }));
    expect(view.hasConnections).toBe(false);
  });
});

describe("aggregateDashboard by project", () => {
  it("puts accounts without a project in the unassigned bucket, listed last", () => {
    const view = aggregateDashboard(
      input([
        money({ metric_key: "fake.spend.month", amount_minor: 1_000, currency: "USD" }),
        money({ external_account_id: "a2", metric_key: "fake.spend.month", amount_minor: 200, currency: "USD" }),
      ]),
    );
    expect(view.byProject.map(({ projectId, name, spend }) => [projectId, name, spend[0]?.verified?.amountMinor])).toEqual([
      ["p1", "Checkout", 1_000],
      [null, "Unassigned", 200],
    ]);
  });

  it("treats an account whose project is not visible as unassigned", () => {
    const view = aggregateDashboard(
      input([money({ metric_key: "fake.spend.month", amount_minor: 1_000, currency: "USD" })], { projects: [] }),
    );
    expect(view.byProject.map(({ projectId }) => projectId)).toEqual([null]);
  });
});

describe("aggregateDashboard allowances", () => {
  const included = quantity({ metric_key: "fake.requests.included", kind: "included_allowance", value: 1_000, unit: "requests", label: "Requests included" });
  const used = quantity({ metric_key: "fake.requests.month", kind: "usage", value: 250, unit: "requests" });

  it("pairs included and used in the same unit and reports remaining as unavailable when missing", () => {
    const view = aggregateDashboard(input([included, used]));
    const [allowance] = view.byProvider[0]?.allowances ?? [];
    expect(allowance?.included?.value).toBe(1_000);
    expect(allowance?.used?.value).toBe(250);
    expect(allowance?.remaining).toBeNull();
    expect(allowance?.percentUsed).toBe(25);
    expect(allowance?.resetsAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("reports percent used as unavailable when the included allowance is zero", () => {
    const view = aggregateDashboard(input([{ ...included, value: 0 }, used]));
    expect(view.byProvider[0]?.allowances[0]?.percentUsed).toBeNull();
  });

  it("does not count usage measured in a different unit against the allowance", () => {
    const view = aggregateDashboard(input([included, { ...used, unit: "GB" }]));
    const [allowance] = view.byProvider[0]?.allowances ?? [];
    expect(allowance?.used).toBeNull();
    expect(allowance?.percentUsed).toBeNull();
  });

  it("builds a card from a remaining allowance alone", () => {
    const remaining = quantity({ metric_key: "fake.requests.remaining", kind: "remaining_allowance", value: 750, unit: "requests" });
    const [allowance] = aggregateDashboard(input([remaining])).byProvider[0]?.allowances ?? [];
    expect(allowance?.remaining?.value).toBe(750);
    expect(allowance?.included).toBeNull();
    expect(allowance?.percentUsed).toBeNull();
  });
});

describe("percentUsed", () => {
  it("returns null when either part is missing", () => {
    expect(percentUsed(null, null)).toBeNull();
  });
});

describe("isStale", () => {
  const retrievedAt = "2026-10-15T10:00:00.000Z";

  it("is fresh at exactly two poll intervals", () => {
    expect(isStale(retrievedAt, HOUR, new Date("2026-10-15T12:00:00.000Z"))).toBe(false);
  });

  it("is stale one millisecond past two poll intervals", () => {
    expect(isStale(retrievedAt, HOUR, new Date("2026-10-15T12:00:00.001Z"))).toBe(true);
  });

  it("marks an aggregated value stale when any of its rows is stale", () => {
    const view = aggregateDashboard(
      input([
        money({ metric_key: "fake.spend.usd", amount_minor: 1, currency: "USD" }),
        money({
          external_account_id: "a2",
          metric_key: "fake.spend.usd",
          amount_minor: 1,
          currency: "USD",
          retrieved_at: "2026-10-15T09:59:59.000Z",
        }),
      ]),
    );
    expect(view.totals[0]?.verified?.stale).toBe(true);
    expect(view.totals[0]?.verified?.retrievedAt).toBe("2026-10-15T09:59:59.000Z");
  });
});

describe("isCurrentPeriod", () => {
  const row = money({ metric_key: "fake.spend.month", amount_minor: 1, currency: "USD" });

  it("counts a month to date window that ends at the retrieval time", () => {
    expect(isCurrentPeriod({ ...row, period_end: row.retrieved_at }, NOW)).toBe(true);
  });

  it("excludes a rolling window that starts mid day", () => {
    expect(isCurrentPeriod({ ...row, period_start: "2026-09-15T11:30:00.000Z" }, NOW)).toBe(false);
  });

  it("excludes a period that ended before the value was read", () => {
    expect(
      isCurrentPeriod(
        { ...row, period_start: "2026-09-01T00:00:00.000Z", period_end: "2026-10-01T00:00:00.000Z" },
        NOW,
      ),
    ).toBe(false);
  });

  it("excludes a period that has not started", () => {
    expect(isCurrentPeriod({ ...row, period_start: "2026-11-01T00:00:00.000Z", period_end: "2026-12-01T00:00:00.000Z" }, NOW)).toBe(false);
  });
});

describe("dropSupersededBreakdowns", () => {
  it("keeps a total and drops its breakdown in the same currency", () => {
    const rows = [
      money({ metric_key: "vercel.spend.total", amount_minor: 300, currency: "USD" }),
      money({ metric_key: "vercel.spend.usage", amount_minor: 200, currency: "USD" }),
      money({ metric_key: "vercel.spend.tax", amount_minor: 100, currency: "USD" }),
      money({ metric_key: "vercel.other.usage", amount_minor: 50, currency: "USD" }),
    ];
    expect(dropSupersededBreakdowns(rows).map((row) => row.metric_key)).toEqual(["vercel.spend.total", "vercel.other.usage"]);
  });
});

describe("latestSnapshots", () => {
  it("prefers the later retrieval on the same day", () => {
    const early = money({ metric_key: "k.a", amount_minor: 1, currency: "USD", retrieved_at: "2026-10-15T01:00:00.000Z" });
    const late = { ...early, amount_minor: 2, retrieved_at: "2026-10-15T02:00:00.000Z" };
    expect(latestSnapshots([late, early]).map((row) => row.amount_minor)).toEqual([2]);
  });
});

describe("formatting", () => {
  it("formats minor units with each currency's own digits", () => {
    expect(formatMoney(12_345, "USD")).toBe("$123.45");
    expect(formatMoney(6_789, "EUR")).toBe("€67.89");
    expect(formatMoney(1_500, "JPY")).toBe("¥1,500");
    // Intl separates the code from the amount with a no-break space.
    expect(formatMoney(1_234, "KWD")).toBe("KWD\u00a01.234");
  });

  it("formats percent on a 0 to 100 scale", () => {
    expect(formatPercent(25)).toBe("25%");
    expect(formatPercent(33.333)).toBe("33.3%");
  });

  it("shows an exclusive period end as the previous UTC day, also in British summer time", () => {
    expect(formatPeriod({ start: MONTH.period_start, end: MONTH.period_end })).toBe("2026-10-01 to 2026-10-31");
    expect(formatPeriod({ start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" })).toBe(
      "2026-06-01 to 2026-06-30",
    );
  });

  it("formats a time in Europe/London", () => {
    expect(formatDateTime("2026-07-01T00:00:00.000Z")).toBe("2026-07-01 01:00 BST");
  });

  it("reads relative time in the largest whole unit", () => {
    expect(formatRelative("2026-10-15T07:00:00.000Z", NOW)).toBe("5 hours ago");
    expect(formatRelative("2026-10-15T11:59:00.000Z", NOW)).toBe("1 minute ago");
    expect(formatRelative("2026-10-15T13:00:00.000Z", NOW)).toBe("now");
    expect(formatRelative("not a date", NOW)).toBe("unknown");
  });

  it("labels stale values with when they were last updated", () => {
    expect(freshnessLabel("2026-10-15T07:00:00.000Z", true, NOW)).toBe("Stale: last updated 5 hours ago");
    expect(freshnessLabel("2026-10-15T11:00:00.000Z", false, NOW)).toBe("Updated 1 hour ago");
  });
});
