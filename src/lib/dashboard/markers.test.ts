import { describe, expect, it } from "vitest";

import { fakeAdapter } from "@/lib/adapters/fake";
import { githubAdapter } from "@/lib/adapters/github";
import { resendAdapter } from "@/lib/adapters/resend";
import { stripeAdapter } from "@/lib/adapters/stripe";
import { supabaseAdapter } from "@/lib/adapters/supabase";
import { vercelAdapter } from "@/lib/adapters/vercel";
import { ALERT_TRIGGERED_TYPE_ID } from "@/lib/alerts/evaluate";
import { EMPTY_SCOPE } from "@/lib/filters/scope";

import {
  bucketEventCounts,
  canonicalHidden,
  chartMarkers,
  MARKER_CATEGORIES,
  markerLabel,
  markerTypeIds,
  markerWindowStart,
  shownCategories,
  toggleHidden,
  type EventCountRow,
} from "./markers";
import { trendBuckets } from "./trends";

// Mid January, so the 13 month window and the 30 day window both cross a year boundary.
const NOW = new Date("2026-01-15T12:00:00.000Z");
const TIMELINE = "/w/acme/timeline";

function row(day: string, type_id: string, event_count: number, provider: EventCountRow["provider"] = "vercel"): EventCountRow {
  return { day, type_id, event_count, provider };
}

describe("markerWindowStart", () => {
  it("starts at the first day of the oldest trend bucket", () => {
    expect(markerWindowStart("daily", NOW)).toBe(trendBuckets("daily", NOW)[0]);
    expect(markerWindowStart("daily", NOW)).toBe("2025-12-17");
    expect(markerWindowStart("monthly", NOW)).toBe("2025-01-01");
  });
});

describe("bucketEventCounts in daily buckets", () => {
  it("sums one provider's types of a category into one count per UTC day", () => {
    const counts = bucketEventCounts(
      [row("2026-01-10", "vercel.deployment.succeeded", 10), row("2026-01-10", "vercel.deployment.failed", 4)],
      "daily",
      NOW,
    );
    expect(counts).toEqual([{ provider: "vercel", category: "deployments", bucket: "2026-01-10", count: 14 }]);
  });

  it("keeps the first and last day of the window and drops the day before and after it", () => {
    const counts = bucketEventCounts(
      [
        row("2025-12-16", "vercel.deployment.succeeded", 1),
        row("2025-12-17", "vercel.deployment.succeeded", 2),
        row("2026-01-15", "vercel.deployment.succeeded", 3),
        row("2026-01-16", "vercel.deployment.succeeded", 4),
      ],
      "daily",
      NOW,
    );
    expect(counts.map(({ bucket, count }) => [bucket, count])).toEqual([
      ["2025-12-17", 2],
      ["2026-01-15", 3],
    ]);
    const buckets = new Set(trendBuckets("daily", NOW));
    expect(counts.every((count) => buckets.has(count.bucket))).toBe(true);
  });

  it("keeps providers apart, keeps DevMacro's own events with no provider, and orders by day then category", () => {
    const counts = bucketEventCounts(
      [
        row("2026-01-11", "stripe.charge.succeeded", 5, "stripe"),
        row("2026-01-10", ALERT_TRIGGERED_TYPE_ID, 1, null),
        row("2026-01-10", "fake.deploy.succeeded", 2, "fake"),
        row("2026-01-10", "vercel.deployment.succeeded", 3),
      ],
      "daily",
      NOW,
    );
    expect(counts).toEqual([
      { provider: "fake", category: "deployments", bucket: "2026-01-10", count: 2 },
      { provider: "vercel", category: "deployments", bucket: "2026-01-10", count: 3 },
      { provider: null, category: "alerts", bucket: "2026-01-10", count: 1 },
      { provider: "stripe", category: "payments", bucket: "2026-01-11", count: 5 },
    ]);
  });

  it("counts a new Stripe customer as a signup on the Stripe chart", () => {
    const counts = bucketEventCounts([row("2026-01-10", "stripe.customer.created", 6, "stripe")], "daily", NOW);
    expect(counts).toEqual([{ provider: "stripe", category: "signups", bucket: "2026-01-10", count: 6 }]);
  });

  it.each([
    { name: "a type in no category", input: row("2026-01-10", "stripe.charge.refunded", 3, "stripe") },
    { name: "a zero count", input: row("2026-01-10", "vercel.deployment.succeeded", 0) },
  ])("drops $name", ({ input }) => {
    expect(bucketEventCounts([input], "daily", NOW)).toEqual([]);
  });

  it("returns nothing for no rows", () => {
    expect(bucketEventCounts([], "daily", NOW)).toEqual([]);
  });
});

describe("bucketEventCounts in monthly buckets", () => {
  it("puts December 31 and January 1 in different months and sums the days of a month", () => {
    const counts = bucketEventCounts(
      [
        row("2025-12-01", "vercel.deployment.succeeded", 1),
        row("2025-12-31", "vercel.deployment.succeeded", 2),
        row("2026-01-01", "vercel.deployment.succeeded", 7),
      ],
      "monthly",
      NOW,
    );
    expect(counts.map(({ bucket, count }) => [bucket, count])).toEqual([
      ["2025-12", 3],
      ["2026-01", 7],
    ]);
  });

  it("keeps the first month of the window and drops the month before it", () => {
    const counts = bucketEventCounts(
      [row("2024-12-31", "vercel.deployment.succeeded", 1), row("2025-01-01", "vercel.deployment.succeeded", 2)],
      "monthly",
      NOW,
    );
    expect(counts).toEqual([{ provider: "vercel", category: "deployments", bucket: "2025-01", count: 2 }]);
    expect(trendBuckets("monthly", NOW)[0]).toBe("2025-01");
  });
});

describe("chartMarkers", () => {
  const counts = bucketEventCounts(
    [
      row("2026-01-10", "vercel.deployment.succeeded", 14),
      row("2026-01-10", ALERT_TRIGGERED_TYPE_ID, 2, null),
      row("2026-01-10", "stripe.charge.succeeded", 9, "stripe"),
      row("2026-01-12", "vercel.deployment.failed", 1),
    ],
    "daily",
    NOW,
  );
  const input = { provider: "vercel", shown: MARKER_CATEGORIES, granularity: "daily", timelinePath: TIMELINE, scope: EMPTY_SCOPE } as const;

  it("marks a provider's chart with its own events and DevMacro's, oldest day first", () => {
    expect(chartMarkers(counts, input).map(({ category, bucket, count }) => [bucket, category, count])).toEqual([
      ["2026-01-10", "deployments", 14],
      ["2026-01-10", "alerts", 2],
      ["2026-01-12", "deployments", 1],
    ]);
  });

  it("leaves hidden categories out", () => {
    const markers = chartMarkers(counts, { ...input, shown: shownCategories(["deployments"]) });
    expect(markers.map((marker) => marker.category)).toEqual(["alerts"]);
    expect(chartMarkers(counts, { ...input, shown: [] })).toEqual([]);
  });

  it("links a provider marker to that provider's types on that UTC date, keeping the project and account filter", () => {
    const scope = { providers: ["vercel", "stripe"], projects: ["unassigned"], accounts: [] } as const;
    const [deployments] = chartMarkers(counts, { ...input, scope });
    expect(deployments?.href).toBe(
      `${TIMELINE}?type=vercel.deployment.failed&type=vercel.deployment.succeeded&from=2026-01-10&to=2026-01-10&provider=vercel&project=unassigned`,
    );
  });

  it("links an alert marker without a provider filter", () => {
    const alerts = chartMarkers(counts, input).find((marker) => marker.category === "alerts");
    expect(alerts?.href).toBe(`${TIMELINE}?type=devmacro.alert_triggered&from=2026-01-10&to=2026-01-10`);
  });

  it("links a monthly marker to the whole UTC month, including its last day", () => {
    const monthly = bucketEventCounts([row("2025-02-14", "vercel.deployment.succeeded", 3)], "monthly", NOW);
    const [marker] = chartMarkers(monthly, { ...input, granularity: "monthly" });
    expect(marker?.href).toBe(
      `${TIMELINE}?type=vercel.deployment.failed&type=vercel.deployment.succeeded&from=2025-02-01&to=2025-02-28&provider=vercel`,
    );
  });
});

describe("markerLabel", () => {
  it.each([
    { marker: { category: "deployments", bucket: "2026-10-21", count: 14 }, granularity: "daily", text: "14 deployments on 2026-10-21" },
    { marker: { category: "alerts", bucket: "2026-10-21", count: 1 }, granularity: "daily", text: "1 triggered alert on 2026-10-21" },
    { marker: { category: "stars", bucket: "2026-10-21", count: 2 }, granularity: "daily", text: "2 star events on 2026-10-21" },
    { marker: { category: "payments", bucket: "2025-12", count: 1204 }, granularity: "monthly", text: "1,204 payments in December 2025" },
  ] as const)("reads $text", ({ marker, granularity, text }) => {
    expect(markerLabel(marker, granularity)).toBe(text);
  });
});

describe("hidden categories in the URL", () => {
  it("toggles a category on and off in category order", () => {
    expect(toggleHidden([], "stars")).toEqual(["stars"]);
    expect(toggleHidden(["stars"], "deployments")).toEqual(["deployments", "stars"]);
    expect(toggleHidden(["deployments", "stars"], "stars")).toEqual(["deployments"]);
  });

  it("orders and deduplicates a hand-edited list", () => {
    expect(canonicalHidden(["alerts", "deployments", "alerts"])).toEqual(["deployments", "alerts"]);
  });

  it("shows every category by default and none when all are hidden", () => {
    expect(shownCategories([])).toEqual([...MARKER_CATEGORIES]);
    expect(shownCategories(MARKER_CATEGORIES)).toEqual([]);
  });
});

describe("category type ids", () => {
  it("names only event types an adapter declares, or DevMacro's alert event", () => {
    const declared = new Set(
      [fakeAdapter, githubAdapter, resendAdapter, stripeAdapter, supabaseAdapter, vercelAdapter].flatMap((adapter) =>
        adapter.eventTypes.map((eventType) => eventType.id),
      ),
    );
    declared.add(ALERT_TRIGGERED_TYPE_ID);
    expect(markerTypeIds(MARKER_CATEGORIES).filter((typeId) => !declared.has(typeId))).toEqual([]);
  });
});
