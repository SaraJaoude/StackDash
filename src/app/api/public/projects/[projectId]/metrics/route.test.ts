import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublishedProjectMetrics } from "@/lib/public-metrics/published";

import { GET } from "./route";

// vi.mock factories run before the imports above, so the mock they share is hoisted with them.
const { loadPublishedProjectMetrics } = vi.hoisted(() => ({
  loadPublishedProjectMetrics: vi.fn<(projectId: string, now: Date) => Promise<PublishedProjectMetrics | null>>(),
}));

vi.mock("@/lib/public-metrics/published", () => ({ loadPublishedProjectMetrics }));
vi.mock("@/lib/log/logger", () => ({ logError: () => "ref-123" }));
// Outside a Next.js request there is no request scope to wait for.
vi.mock("next/server", () => ({ connection: async () => {} }));

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const AT = new Date("2026-11-05T12:00:00Z");

function get(projectId: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/public/projects/${projectId}/metrics`), {
    params: Promise.resolve({ projectId }),
  });
}

afterEach(() => {
  loadPublishedProjectMetrics.mockReset();
});

describe("GET /api/public/projects/[projectId]/metrics", () => {
  it("returns live publications with provenance, last sync, and a one minute cache", async () => {
    loadPublishedProjectMetrics.mockResolvedValue({
      projectId: PROJECT_ID,
      workspaceId: "20000000-0000-4000-8000-000000000001",
      metrics: [
        {
          kind: "engine",
          publicationId: "80000000-0000-4000-8000-000000000001",
          metricId: "github-stars",
          label: "GitHub stars",
          unit: "stars",
          provenance: "verified",
          formulaPath: "/docs/architecture/public-metrics#github-stars",
          rounding: "hundreds",
          delayDays: 0,
          publishedAt: AT,
          asOf: AT,
          value: { status: "available", value: 1200, text: "at least 1,200 stars", atLeast: true, lastSyncedAt: AT, simulated: false },
        },
        {
          kind: "engine",
          publicationId: "80000000-0000-4000-8000-000000000002",
          metricId: "vercel-deployments-30d",
          label: "Deployments in 30 days",
          unit: "deployments",
          provenance: "verified",
          formulaPath: "/docs/architecture/public-metrics#vercel-deployments-30d",
          rounding: "exact",
          delayDays: 7,
          publishedAt: AT,
          asOf: AT,
          value: { status: "unavailable", reason: "not_enough_history", text: "Not enough history yet" },
        },
        {
          kind: "self_reported",
          publicationId: "80000000-0000-4000-8000-000000000003",
          label: "Downloads",
          unit: "downloads",
          provenance: "self_reported",
          value: 42,
          text: "42 downloads",
          publishedAt: AT,
        },
      ],
    });

    const response = await get(PROJECT_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    const body = await response.json();
    expect(body.projectId).toBe(PROJECT_ID);
    expect(body.metrics[0]).toMatchObject({
      kind: "engine",
      id: "github-stars",
      provenance: "verified",
      status: "available",
      value: 1200,
      atLeast: true,
      lastSyncedAt: AT.toISOString(),
      formulaUrl: "/docs/architecture/public-metrics#github-stars",
    });
    expect(body.metrics[1]).toEqual(expect.objectContaining({ status: "unavailable", reason: "not_enough_history" }));
    expect(body.metrics[1]).not.toHaveProperty("value");
    expect(body.metrics[2]).toEqual(expect.objectContaining({ kind: "self_reported", provenance: "self_reported", value: 42 }));
    // Internal ids stay inside: no workspace id or publication ids in the public answer.
    expect(JSON.stringify(body)).not.toMatch(/20000000-0000-4000-8000-000000000001|80000000-/);
  });

  it.each([
    ["a malformed id", "not-a-uuid", false],
    ["an empty id", "", false],
    ["a project with nothing published", PROJECT_ID, true],
  ])("answers the same 404 for %s", async (_title, projectId, reachesDatabase) => {
    loadPublishedProjectMetrics.mockResolvedValue(null);
    const response = await get(projectId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found", message: "Nothing is published for this project." });
    expect(loadPublishedProjectMetrics).toHaveBeenCalledTimes(reachesDatabase ? 1 : 0);
  });

  it("answers 503 with a reference and no detail when the read fails, and is not cached", async () => {
    loadPublishedProjectMetrics.mockRejectedValue(new Error("connection refused at 10.0.0.1"));
    const response = await get(PROJECT_ID);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ error: "unavailable", message: "Published metrics could not be read. Try again in a moment.", referenceId: "ref-123" });
  });
});
