import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log/logger";
import { PUBLIC_METRICS } from "@/lib/public-metrics/definitions";
import { ACCOUNTS_LIMIT } from "@/lib/public-metrics/supabase-store";

import { loadProjectPublications } from "./published-metrics";

/*
 * The owner's public metrics settings page past the included account bound (#220). The metric
 * store throws rather than compute from part of the accounts; this page must still render, since it
 * holds every Unpublish control, with each engine metric unavailable and the reason, while any other
 * failure stays the page's error. The query builder answers per table; the store is the real one.
 */

type Result = { data: unknown; error: { message: string } | null };

const { results } = vi.hoisted(() => ({ results: new Map<string, Result>() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const builder = {
        then(resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(results.get(table) ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      for (const method of ["select", "eq", "neq", "in", "is", "gte", "order", "limit", "maybeSingle"]) {
        Object.assign(builder, { [method]: () => builder });
      }
      return builder;
    },
  }),
}));

const WORKSPACE_ID = "22000000-0000-4000-8000-000000000001";
const PROJECT_ID = "22000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-06T12:00:00Z");

function seed(accountCount: number) {
  results.set("projects", { data: { id: PROJECT_ID, name: "Acme web" }, error: null });
  results.set("published_metrics", {
    data: [
      {
        id: "22000000-0000-4000-8000-000000000010",
        metric_id: "github-stars",
        self_reported_label: null,
        self_reported_value: null,
        self_reported_unit: null,
        rounding: "exact",
        delay_days: 0,
        published_at: "2026-11-01T09:00:00Z",
      },
      {
        id: "22000000-0000-4000-8000-000000000011",
        metric_id: null,
        self_reported_label: "Downloads",
        self_reported_value: 4200,
        self_reported_unit: "downloads",
        rounding: "exact",
        delay_days: 0,
        published_at: "2026-11-01T09:00:00Z",
      },
    ],
    error: null,
  });
  // The store asks for one past ACCOUNTS_LIMIT; this answers with `accountCount` rows. Their
  // connection is not returned, so a read within the bound reads "not connected".
  results.set("external_accounts", {
    data: Array.from({ length: accountCount }, (_, index) => ({
      id: `22000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
      connection_id: "22000000-0000-4000-8000-000000000003",
    })),
    error: null,
  });
}

beforeEach(() => {
  results.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadProjectPublications", () => {
  it("computes every engine metric (boundary: exactly ACCOUNTS_LIMIT included accounts)", async () => {
    seed(ACCOUNTS_LIMIT);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const page = await loadProjectPublications(WORKSPACE_ID, PROJECT_ID, NOW);
    expect(page?.tooManyAccounts).toBe(false);
    expect(page?.metrics.map((metric) => metric.current)).toEqual(
      PUBLIC_METRICS.map(() => ({ status: "unavailable", reason: "not_connected", text: "Not connected" })),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the page with every engine metric unavailable and why (boundary: one past ACCOUNTS_LIMIT)", async () => {
    seed(ACCOUNTS_LIMIT + 1);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const page = await loadProjectPublications(WORKSPACE_ID, PROJECT_ID, NOW);
    const tooMany = { status: "unavailable", reason: "too_many_accounts", text: "Not computed: too many accounts" };
    expect(page?.tooManyAccounts).toBe(true);
    expect(page?.metrics.map((metric) => metric.current)).toEqual(PUBLIC_METRICS.map(() => tooMany));
    // The publication stays listed, so the owner can still unpublish it.
    const stars = page?.metrics.find((metric) => metric.metricId === "github-stars");
    expect(stars?.publication).toMatchObject({ publicationId: "22000000-0000-4000-8000-000000000010", asOf: NOW, value: tooMany });
    expect(page?.selfReported.map((entry) => entry.label)).toEqual(["Downloads"]);
    expect(warn).toHaveBeenCalledWith("public_metrics.settings_accounts_over_limit", { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID });
  });

  it("still fails the page when the account read itself fails (boundary: not the bound)", async () => {
    seed(1);
    results.set("external_accounts", { data: null, error: { message: "connection reset" } });
    await expect(loadProjectPublications(WORKSPACE_ID, PROJECT_ID, NOW)).rejects.toThrow("Failed to load the project's accounts");
  });
});
