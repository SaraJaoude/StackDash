import { describe, expect, it } from "vitest";

import { PUBLIC_METRICS } from "@/lib/public-metrics/definitions";

import { DEMO_USER_EMAIL, demoPublicMetricIds, memberEmails } from "./workspace";

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
    expect(ids).toEqual(PUBLIC_METRICS.filter((definition) => ["vercel", "github"].includes(definition.provider)).map((definition) => definition.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("lists nothing for a project with no provider that has public metrics (boundary)", () => {
    expect(demoPublicMetricIds([])).toEqual([]);
    expect(demoPublicMetricIds(["fake", "posthog"])).toEqual([]);
  });
});
