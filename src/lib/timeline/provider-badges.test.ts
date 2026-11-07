import { describe, expect, it } from "vitest";

import { providerBadgeQuery, providerBadges, providerBadgeText } from "./provider-badges";
import { parseTimelineSearchParams } from "./query";

describe("providerBadges", () => {
  it("returns no badges for no connections", () => {
    expect(providerBadges([])).toEqual([]);
  });

  it("sums the connections of one provider into one badge", () => {
    expect(
      providerBadges([
        { provider: "stripe", events: 1000 },
        { provider: "vercel", events: 60 },
        { provider: "stripe", events: 240 },
      ]),
    ).toEqual([
      { provider: "stripe", connections: 2, events: 1240 },
      { provider: "vercel", connections: 1, events: 60 },
    ]);
  });

  it("orders by events, then by provider name on a tie", () => {
    expect(
      providerBadges([
        { provider: "vercel", events: 5 },
        { provider: "github", events: 5 },
        { provider: "stripe", events: 9 },
      ]).map((badge) => badge.provider),
    ).toEqual(["stripe", "github", "vercel"]);
  });
});

describe("providerBadgeText", () => {
  it.each([
    { name: "one event from one connection is singular", events: 1, connections: 1, label: "Stripe: 1 event from 1 connection", short: "1" },
    { name: "plural events and connections", events: 2, connections: 2, label: "Stripe: 2 events from 2 connections", short: "2" },
    { name: "the largest unshortened count", events: 999, connections: 1, label: "Stripe: 999 events from 1 connection", short: "999" },
    { name: "the first shortened count", events: 1000, connections: 1, label: "Stripe: 1,000 events from 1 connection", short: "1K" },
    { name: "one decimal in the badge", events: 1240, connections: 2, label: "Stripe: 1,240 events from 2 connections", short: "1.2K" },
    { name: "rounding up into millions", events: 999_999, connections: 3, label: "Stripe: 999,999 events from 3 connections", short: "1M" },
  ])("$name: $short in the badge, the exact counts in the label", ({ events, connections, label, short }) => {
    expect(providerBadgeText({ provider: "stripe", connections, events })).toEqual({ label, short });
  });
});

describe("providerBadgeQuery", () => {
  it("filters to only its provider, keeping every other filter", () => {
    const query = parseTimelineSearchParams({ severity: "critical", provider: ["github", "stripe"] });
    const { query: next, current } = providerBadgeQuery(query, "stripe");
    expect(current).toBe(false);
    expect(next.scope.providers).toEqual(["stripe"]);
    expect(next.severities).toEqual(["critical"]);
  });

  it("links back to every provider when its provider is already the whole filter", () => {
    const query = parseTimelineSearchParams({ severity: "critical", provider: "stripe" });
    const { query: next, current } = providerBadgeQuery(query, "stripe");
    expect(current).toBe(true);
    expect(next.scope.providers).toEqual([]);
    expect(next.severities).toEqual(["critical"]);
  });

  it("is not current under no provider filter", () => {
    expect(providerBadgeQuery(parseTimelineSearchParams({}), "stripe").current).toBe(false);
  });
});
