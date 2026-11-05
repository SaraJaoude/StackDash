import { describe, expect, it } from "vitest";

import { fakeAdapter } from "@/lib/adapters/fake";
import { Secret, type ProviderAdapter } from "@/lib/adapters/types";
import type { Logger } from "@/lib/log/logger";

import { DAILY_SUMMARY_TYPE_ID, dailySummaryJobKey, runDailySummaryJob, summaryDate } from "./daily-summary";
import { MemoryJobStore, type MemorySnapshot } from "./memory-store";
import { runTick } from "./runner";
import type { SyncDeps } from "./sync-connection";

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const vercelStub: ProviderAdapter = { ...fakeAdapter, id: "vercel", displayName: "Vercel" };

function setup(start = "2026-10-15T00:05:00.000Z") {
  const clock = new Date(start);
  const now = () => clock;
  const store = new MemoryJobStore(now);
  const deps: SyncDeps = {
    store,
    getAdapter: (id) => (id === "vercel" ? vercelStub : fakeAdapter),
    loadOAuthClient: () => ({ clientId: "id", clientSecret: new Secret("secret"), extra: {} }),
    createOAuthContext: (client) => ({ client, fetch: () => Promise.reject(new Error("offline")), now, timeoutMs: 1000, logger: silent }),
    now,
    random: () => 0.5,
    logError: () => "REF-TEST0000",
    log: silent,
    evaluateAlerts: async () => ({ triggered: 0 }),
  };
  return { store, deps, now };
}

function snapshot(fields: Partial<MemorySnapshot> & Pick<MemorySnapshot, "connection_id" | "metric_key" | "kind">): MemorySnapshot {
  return {
    id: crypto.randomUUID(),
    workspace_id: WORKSPACE_ID,
    external_account_id: crypto.randomUUID(),
    label: "Metric",
    snapshot_date: "2026-10-14",
    point_at: "2026-10-14T23:00:00.000Z",
    retrieved_at: "2026-10-14T23:00:00.000Z",
    provenance_source: "provider_api",
    ...fields,
  };
}

function summaries(store: MemoryJobStore) {
  return store.events.filter((event) => event.type_id === DAILY_SUMMARY_TYPE_ID);
}

describe("summaryDate", () => {
  it("reports on the previous UTC day, at both edges of the day", () => {
    expect(summaryDate(new Date("2026-10-15T00:00:00.000Z"))).toBe("2026-10-14");
    expect(summaryDate(new Date("2026-10-15T23:59:59.999Z"))).toBe("2026-10-14");
  });
});

describe("daily summary (#64)", () => {
  it("writes exactly one summary per workspace per day even if the job runs twice", async () => {
    const { store, deps } = setup();
    const connection = store.addConnection({ workspace_id: WORKSPACE_ID, provider: "fake", status: "needs_attention" });
    store.snapshots.push(
      snapshot({ connection_id: connection.id, metric_key: "fake.spend.month", kind: "verified_spend", amount_minor: 1234, currency: "USD" }),
    );

    const first = await runTick(deps);
    expect(first.summariesQueued).toBe(1);
    const second = await runTick(deps);
    expect(second.summariesQueued).toBe(0);

    const job = store.jobs.find((row) => row.kind === "daily_summary");
    expect(job?.dedupe_key).toBe(dailySummaryJobKey(WORKSPACE_ID, "2026-10-14"));
    expect(job?.status).toBe("succeeded");
    if (job === undefined) throw new Error("no summary job");
    // The same job run again (a retry after a lost lease) still writes one event.
    await runDailySummaryJob(job, deps);

    const events = summaries(store);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: null,
      connection_id: null,
      url: null,
      dedupe_key: "daily_summary:2026-10-14",
      title: "Daily summary for 2026-10-14",
      occurred_at: "2026-10-15T00:00:00.000Z",
    });
  });

  it("writes no summary for a workspace without connections", async () => {
    const { store, deps } = setup();
    // Another workspace has a connection, so the scheduler runs, but not for this workspace.
    store.addConnection({ workspace_id: OTHER_WORKSPACE_ID, provider: "fake", status: "needs_attention" });
    store.addConnection({ workspace_id: WORKSPACE_ID, provider: "fake", status: "revoked" });

    const result = await runTick(deps);
    expect(result.summariesQueued).toBe(1);
    expect(summaries(store).map((event) => event.workspace_id)).toEqual([OTHER_WORKSPACE_ID]);

    const orphan = store.newJob({
      workspace_id: WORKSPACE_ID,
      connection_id: null,
      kind: "daily_summary",
      dedupe_key: dailySummaryJobKey(WORKSPACE_ID, "2026-10-14"),
    });
    expect(await runDailySummaryJob(orphan, deps)).toEqual({ status: "succeeded" });
    expect(summaries(store).filter((event) => event.workspace_id === WORKSPACE_ID)).toHaveLength(0);
  });

  it("labels every value verified, estimated, or unavailable", async () => {
    const { store, deps } = setup();
    const fake = store.addConnection({ workspace_id: WORKSPACE_ID, provider: "fake", status: "needs_attention" });
    store.addConnection({ workspace_id: WORKSPACE_ID, provider: "vercel", status: "needs_attention" });
    store.snapshots.push(
      snapshot({ connection_id: fake.id, metric_key: "fake.spend.month", kind: "verified_spend", amount_minor: 1234, currency: "USD" }),
      snapshot({ connection_id: fake.id, metric_key: "fake.cost.estimate", kind: "estimated_spend", amount_minor: 4000, currency: "USD", provenance_source: "derived", pricing_source: "List" }),
      snapshot({ connection_id: fake.id, metric_key: "fake.requests.month", kind: "usage", label: "Requests this month", value: 16800, unit: "requests" }),
      // A different day is not part of the summary.
      snapshot({ connection_id: fake.id, metric_key: "fake.spend.month", kind: "verified_spend", amount_minor: 999, currency: "USD", snapshot_date: "2026-10-13" }),
    );

    await runTick(deps);
    const body = summaries(store)[0]?.body ?? "";
    expect(body.split("\n")).toEqual([
      "Example provider: Spending $40.00 (estimated)",
      "Example provider: Spending $12.34 (verified)",
      "Example provider: Requests this month 16,800 requests (verified)",
      // Point readings with no reset say nothing about when the period ends.
      "Example provider: Spending projection in USD unavailable (the end of the period is unknown)",
      "Vercel: Spending unavailable",
      "Vercel: Usage unavailable",
    ]);
  });

  it("keeps two currencies apart and never adds them together", async () => {
    const { store, deps } = setup();
    const fake = store.addConnection({ workspace_id: WORKSPACE_ID, provider: "fake", status: "needs_attention" });
    store.snapshots.push(
      snapshot({ connection_id: fake.id, metric_key: "fake.spend.month", kind: "verified_spend", amount_minor: 1000, currency: "USD" }),
      snapshot({ connection_id: fake.id, metric_key: "fake.spend.month", kind: "verified_spend", amount_minor: 250, currency: "USD" }),
      snapshot({ connection_id: fake.id, metric_key: "fake.spend.month", kind: "verified_spend", amount_minor: 500, currency: "EUR" }),
    );

    await runTick(deps);
    const body = summaries(store)[0]?.body ?? "";
    expect(body).toContain("Example provider: Spending €5.00 (verified)");
    expect(body).toContain("Example provider: Spending $12.50 (verified)");
    expect(body).not.toContain("17.50");
  });

  describe("projection to the end of the period (#167)", () => {
    const ACCOUNT = "44444444-4444-4444-8444-444444444444";
    const NOVEMBER = { period_start: "2026-11-01T00:00:00.000Z", period_end: "2026-12-01T00:00:00.000Z", point_at: null };

    /** One reading a day at 06:00 UTC from 2026-11-01, for the summary of 2026-11-05. */
    function daily(connectionId: string, values: readonly number[], fields: Partial<MemorySnapshot> & Pick<MemorySnapshot, "metric_key" | "kind">) {
      return values.map((value, index) => {
        const date = `2026-11-0${index + 1}`;
        const at = `${date}T06:00:00.000Z`;
        return snapshot({
          connection_id: connectionId,
          external_account_id: ACCOUNT,
          snapshot_date: date,
          retrieved_at: at,
          ...NOVEMBER,
          ...(fields.kind === "verified_spend" ? { amount_minor: value, currency: "USD" } : { value, unit: "requests" }),
          ...fields,
        });
      });
    }

    it("adds the spend projection and a quota's run-out date, labeled as estimates", async () => {
      const { store, deps } = setup("2026-11-06T00:05:00.000Z");
      const fake = store.addConnection({ workspace_id: WORKSPACE_ID, provider: "fake", status: "needs_attention" });
      const resets = { resets_at: "2026-12-01T00:00:00.000Z" };
      store.snapshots.push(
        ...daily(fake.id, [100, 200, 300, 400, 500], { metric_key: "fake.spend.month", kind: "verified_spend" }),
        ...daily(fake.id, [400, 800, 1200, 1600, 2000], { metric_key: "fake.requests.month", kind: "usage", label: "Requests this month", ...resets }),
        ...daily(fake.id, [3000], {
          metric_key: "fake.requests.included",
          kind: "included_allowance",
          label: "Requests included in the plan",
          snapshot_date: "2026-11-05",
          retrieved_at: "2026-11-05T06:00:00.000Z",
          ...resets,
        }),
        // After the summarized day: never part of it, not even of the projection.
        ...daily(fake.id, [100, 200, 300, 400, 500, 99999], { metric_key: "fake.spend.month", kind: "verified_spend" }).slice(5),
      );

      await runTick(deps);
      const body = summaries(store)[0]?.body ?? "";
      expect(body.split("\n")).toEqual([
        "Example provider: Spending $5.00 (verified)",
        "Example provider: Requests this month 2,000 requests (verified)",
        // 500 cents plus 100 a day from 2026-11-05 06:00 to 2026-12-01.
        "Example provider: Spending on track for $30.75 by 2026-11-30 (estimate by DevMacro)",
        "Example provider: Requests included in the plan runs out around 2026-11-07 (estimate by DevMacro)",
      ]);
    });

    it("says why there is no projection with fewer than 3 days of data", async () => {
      const { store, deps } = setup("2026-11-03T00:05:00.000Z");
      const fake = store.addConnection({ workspace_id: WORKSPACE_ID, provider: "fake", status: "needs_attention" });
      store.snapshots.push(...daily(fake.id, [100, 200], { metric_key: "fake.spend.month", kind: "verified_spend" }));

      await runTick(deps);
      expect(summaries(store)[0]?.body).toContain("Example provider: Spending projection in USD unavailable (fewer than 3 days of data)");
    });
  });
});
