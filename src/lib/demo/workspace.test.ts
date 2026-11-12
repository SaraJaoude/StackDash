import { describe, expect, it } from "vitest";

import { PUBLIC_METRICS } from "@/lib/public-metrics/definitions";

import { DEMO_USER_EMAIL, demoPublicMetricIds, memberEmails, sampleDataRefusal } from "./workspace";

describe("memberEmails", () => {
  it("keeps each email once, in the order given", () => {
    expect(memberEmails(["ada@example.com", "grace@example.com", "ada@example.com"])).toEqual(["ada@example.com", "grace@example.com"]);
  });

  it("is empty when no member is given", () => {
    expect(memberEmails([])).toEqual([]);
  });

  it("refuses the demo account, even beside a real member", () => {
    expect(() => memberEmails(["ada@example.com", DEMO_USER_EMAIL])).toThrow(/is the demo account/);
  });
});

describe("demoPublicMetricIds", () => {
  it("lists every metric the project's providers can count, once each, in definition order", () => {
    const ids = demoPublicMetricIds(["vercel", "github", "vercel"]);
    expect(ids).toEqual(
      PUBLIC_METRICS.filter((definition) => definition.providers.some((provider) => provider === "vercel" || provider === "github")).map(
        (definition) => definition.id,
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("lists a metric that counts several providers for any one of them (boundary: Railway only)", () => {
    expect(demoPublicMetricIds(["railway"])).toEqual(["vercel-deployments-7d", "vercel-deployments-30d"]);
  });

  it("lists nothing for a project with no provider that has public metrics (boundary)", () => {
    expect(demoPublicMetricIds([])).toEqual([]);
    expect(demoPublicMetricIds(["fake", "posthog"])).toEqual([]);
  });
});

describe("sampleDataRefusal", () => {
  it("allows an empty workspace while simulation is on", () => {
    expect(sampleDataRefusal({ simulationEnabled: true, connectionCount: 0 })).toBeNull();
  });

  it.each([
    ["simulation off, empty workspace", false, 0, /simulation is on/],
    ["simulation off, with connections", false, 3, /simulation is on/],
    ["one connection (boundary)", true, 1, /already has connections/],
    ["many connections", true, 100, /already has connections/],
  ])("refuses with %s", (_title, simulationEnabled, connectionCount, message) => {
    expect(sampleDataRefusal({ simulationEnabled, connectionCount })).toMatch(message);
  });
});
