import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { billingMetricNames } from "@/lib/adapters/github/billing";
import { starMetricNames } from "@/lib/adapters/github/repositories";
import { simulatedAdapters } from "@/lib/adapters/simulated";
import { githubProfile } from "@/lib/adapters/simulated/github";
import { resendProfile } from "@/lib/adapters/simulated/resend";
import type { AdapterContext } from "@/lib/adapters/types";
import { Constants } from "@/lib/supabase/database.types";

import {
  allowedRoundings,
  countsProvider,
  DEPLOYMENT_OUTCOMES,
  formulaPath,
  isPublicMetricId,
  PUBLIC_METRIC_IDS,
  PUBLIC_METRICS,
  publicMetricDefinition,
  type MetricSource,
} from "./definitions";

const AT = new Date("2026-11-05T12:00:00Z");

function sourceKeys(source: MetricSource): string[] {
  switch (source.type) {
    case "snapshot_total":
    case "snapshot_change":
      return [source.metricKey];
    case "snapshot_percent":
      return [source.numeratorKey, source.denominatorKey];
    case "event_count":
    case "event_streak":
      return [];
  }
}

function sourceEventTypes(source: MetricSource): string[] {
  switch (source.type) {
    case "event_count":
      return [...source.typeIds];
    case "event_streak":
      return [source.successTypeId, source.failureTypeId];
    default:
      return [];
  }
}

// What the adapters store, from their simulated twins, which reuse the real adapters' key builders.
// Neither profile reads the context; it only completes the profile signature.
const ctx: AdapterContext = {
  fetch: () => Promise.reject(new Error("no network in tests")),
  now: () => AT,
  timeoutMs: 1000,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
};
const storedMetrics = [...githubProfile.metrics("simdefs", AT, ctx), ...resendProfile.metrics("simdefs", AT, ctx)];

describe("public metric definitions", () => {
  it("defines every id of the database enum exactly once, in its order", () => {
    expect(PUBLIC_METRICS.map((definition) => definition.id)).toEqual([...Constants.public.Enums.public_metric_id]);
    expect(new Set(PUBLIC_METRICS.map((definition) => definition.label)).size).toBe(PUBLIC_METRICS.length);
  });

  it.each(PUBLIC_METRICS.map((definition) => [definition.id, definition] as const))(
    "%s reads only quantities or events its providers declare",
    (_id, definition) => {
      for (const key of sourceKeys(definition.source)) {
        expect(definition.providers.some((provider) => key.startsWith(`${provider}.`)), key).toBe(true);
        const stored = storedMetrics.filter((metric) => metric.metricKey === key);
        expect(stored.length, `${key} is stored by an adapter`).toBeGreaterThan(0);
        for (const metric of stored) expect(["usage", "included_allowance", "remaining_allowance"]).toContain(metric.kind);
      }
      const declared = definition.providers.flatMap((provider) => simulatedAdapters[provider].eventTypes.map((type) => type.id));
      for (const typeId of sourceEventTypes(definition.source)) expect(declared, typeId).toContain(typeId);
    },
  );

  it("lists exactly the deployment outcomes the adapters declare, one success and one failure per provider", () => {
    const declared = Object.entries(simulatedAdapters)
      .flatMap(([provider, adapter]) =>
        adapter.eventTypes.flatMap((type) =>
          type.category === "deploy_succeeded" || type.category === "deploy_failed" ? [`${provider} ${type.category} ${type.id}`] : [],
        ),
      )
      .sort();
    const listed = DEPLOYMENT_OUTCOMES.flatMap((outcome) => [
      `${outcome.provider} deploy_succeeded ${outcome.successTypeId}`,
      `${outcome.provider} deploy_failed ${outcome.failureTypeId}`,
    ]).sort();
    expect(listed).toEqual(declared);
  });

  it.each(["vercel-deployments-7d", "vercel-deployments-30d"] as const)(
    "%s counts every deployment provider's successes, and nothing of another provider (boundary: Railway only)",
    (id) => {
      const definition = publicMetricDefinition(id);
      expect(definition.providers).toEqual(DEPLOYMENT_OUTCOMES.map((outcome) => outcome.provider));
      expect(definition.source).toEqual({ type: "event_count", typeIds: DEPLOYMENT_OUTCOMES.map((outcome) => outcome.successTypeId) });
      expect(countsProvider(definition, "railway")).toBe(true);
      expect(countsProvider(definition, "github")).toBe(false);
      // The formula names each provider as every other surface does, the run slide included.
      expect(definition.formula).toContain("on the project's DigitalOcean, GitLab, Railway, and Vercel accounts");
    },
  );

  it("names at least one provider for every metric (boundary: never empty)", () => {
    for (const definition of PUBLIC_METRICS) expect(definition.providers.length, definition.id).toBeGreaterThan(0);
  });

  it("has no id, label, or source for spend, budgets, alerts, or revenue", () => {
    for (const definition of PUBLIC_METRICS) {
      const text = [definition.id, definition.label, ...sourceKeys(definition.source), ...sourceEventTypes(definition.source)].join(" ");
      expect(text).not.toMatch(/spend|budget|alert|revenue|fee|cost|amount|price/i);
    }
    expect(isPublicMetricId("github-spend-actions")).toBe(false);
    expect(isPublicMetricId("budget")).toBe(false);
    expect(isPublicMetricId("github-stars")).toBe(true);
    expect(isPublicMetricId("")).toBe(false);
  });

  it("spells the GitHub keys as the adapter builds them", () => {
    // definitions.ts writes these as literals so it stays client-safe (no adapter import).
    expect(publicMetricDefinition("github-stars").source).toEqual({ type: "snapshot_total", metricKey: starMetricNames.total.metricKey });
    expect(publicMetricDefinition("github-actions-minutes-month").source).toMatchObject({
      metricKey: billingMetricNames.usage("Actions", "Minutes").metricKey,
    });
  });

  it("states a window for every count and change, and none for current values and streaks", () => {
    for (const definition of PUBLIC_METRICS) {
      const windowed = definition.source.type === "event_count" || definition.source.type === "snapshot_change";
      expect(definition.windowDays > 0, definition.id).toBe(windowed);
    }
  });

  it("writes user-facing text without em or en dashes", () => {
    for (const definition of PUBLIC_METRICS) {
      expect(`${definition.label} ${definition.formula}`).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("offers rounding to tens at most for a percent, every rounding for counts", () => {
    expect(allowedRoundings(publicMetricDefinition("resend-quota-percent-month").unit)).toEqual(["exact", "tens"]);
    expect(allowedRoundings(publicMetricDefinition("github-stars").unit)).toEqual(Constants.public.Enums.published_metric_rounding);
  });

  it("documents every metric's formula on the formulas page under a heading named by its id", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/architecture/public-metrics.md"), "utf8");
    for (const id of PUBLIC_METRIC_IDS) {
      const definition = publicMetricDefinition(id);
      expect(formulaPath(id)).toBe(`/docs/architecture/public-metrics#${id}`);
      expect(doc, id).toContain(`### \`${id}\``);
      expect(doc, id).toContain(definition.formula);
    }
  });
});
