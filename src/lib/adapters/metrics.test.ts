import { describe, expect, it } from "vitest";
import { validateAdapterMetrics, type AdapterMetric } from "./metrics";

const retrievedAt = new Date("2026-10-31T12:00:00Z");
const october = {
  type: "period",
  start: new Date("2026-10-01T00:00:00Z"),
  end: new Date("2026-11-01T00:00:00Z"),
} as const;

const usage: AdapterMetric = {
  kind: "usage",
  metricKey: "resend.emails.monthly",
  label: "Emails sent this month",
  timeframe: october,
  externalAccountId: "team_1",
  retrievedAt,
  provenance: { source: "provider_api", endpoint: "https://api.resend.com/emails" },
  value: 1250,
  unit: "emails",
  resetsAt: october.end,
};

const verifiedSpend: AdapterMetric = {
  kind: "verified_spend",
  metricKey: "resend.spend.monthly",
  label: "Spend this month",
  timeframe: october,
  externalAccountId: "team_1",
  retrievedAt,
  provenance: { source: "provider_api" },
  amountMinor: 2000,
  currency: "USD",
};

function omit(source: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

describe("validateAdapterMetrics", () => {
  it.each([
    { name: "usage over a period", metric: usage },
    { name: "verified spend in minor units", metric: verifiedSpend },
    {
      name: "estimated spend with a pricing source",
      metric: {
        ...verifiedSpend,
        kind: "estimated_spend",
        provenance: { source: "derived", pricingSource: "https://resend.com/pricing" },
      },
    },
    {
      name: "remaining allowance of zero at a point in time",
      metric: { ...usage, kind: "remaining_allowance", value: 0, timeframe: { type: "point", at: retrievedAt } },
    },
    { name: "negative revenue after refunds", metric: { ...verifiedSpend, kind: "revenue", amountMinor: -500 } },
    { name: "largest safe integer amount", metric: { ...verifiedSpend, amountMinor: Number.MAX_SAFE_INTEGER } },
  ])("accepts $name", ({ metric }) => {
    const result = validateAdapterMetrics("resend", [metric]);
    expect(result).toEqual({ ok: true, items: [metric] });
  });

  it.each([
    { name: "missing unit", metric: omit(usage, "unit"), path: "unit" },
    { name: "empty unit", metric: { ...usage, unit: "" }, path: "unit" },
    { name: "missing provenance", metric: omit(usage, "provenance"), path: "provenance" },
    { name: "negative value", metric: { ...usage, value: -1 }, path: "value" },
    { name: "NaN value", metric: { ...usage, value: Number.NaN }, path: "value" },
    { name: "Infinity value", metric: { ...usage, value: Number.POSITIVE_INFINITY }, path: "value" },
    { name: "float amountMinor", metric: { ...verifiedSpend, amountMinor: 19.99 }, path: "amountMinor" },
    {
      name: "unsafe integer amountMinor",
      metric: { ...verifiedSpend, amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      path: "amountMinor",
    },
    { name: "negative spend", metric: { ...verifiedSpend, amountMinor: -1 }, path: "amountMinor" },
    { name: "lowercase currency", metric: { ...verifiedSpend, currency: "usd" }, path: "currency" },
    { name: "four letter currency", metric: { ...verifiedSpend, currency: "USDT" }, path: "currency" },
    {
      name: "period end equal to start",
      metric: { ...usage, timeframe: { type: "period", start: october.start, end: october.start } },
      path: "timeframe.end",
    },
    {
      name: "period end before start",
      metric: { ...usage, timeframe: { type: "period", start: october.end, end: october.start } },
      path: "timeframe.end",
    },
    {
      name: "estimated spend without a pricing source",
      metric: { ...verifiedSpend, kind: "estimated_spend", provenance: { source: "derived" } },
      path: "provenance.pricingSource",
    },
    { name: "adapter-emitted budget", metric: { ...verifiedSpend, kind: "budget" }, path: "kind" },
    { name: "adapter-emitted budget that is otherwise malformed", metric: { kind: "budget" }, path: "kind" },
    { name: "metric key owned by another provider", metric: { ...usage, metricKey: "vercel.emails.monthly" }, path: "metricKey" },
    { name: "undotted metric key", metric: { ...usage, metricKey: "resend" }, path: "metricKey" },
    { name: "unknown kind", metric: { ...usage, kind: "quota" }, path: "kind" },
    { name: "unnamed extra field", metric: { ...usage, ownerEmail: "someone@example.com" }, path: "" },
  ])("rejects $name", ({ metric, path }) => {
    const result = validateAdapterMetrics("resend", [metric]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ index: 0, path }));
  });

  it("rejects the whole batch when one metric of many is invalid", () => {
    const result = validateAdapterMetrics("resend", [usage, omit(usage, "unit"), verifiedSpend]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.index)).toEqual([1]);
  });

  it("accepts an empty batch", () => {
    expect(validateAdapterMetrics("resend", [])).toEqual({ ok: true, items: [] });
  });
});
