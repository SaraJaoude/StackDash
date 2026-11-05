import { describe, expect, it } from "vitest";

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
    expect(demoPublicMetricIds(["vercel", "github", "vercel"])).toEqual([
      "github-stars",
      "github-stars-gained-7d",
      "github-stars-gained-30d",
      "vercel-deployments-7d",
      "vercel-deployments-30d",
      "vercel-deployment-streak",
      "github-actions-minutes-month",
    ]);
  });

  it("lists nothing for a project with no provider that has public metrics (boundary)", () => {
    expect(demoPublicMetricIds([])).toEqual([]);
    expect(demoPublicMetricIds(["fake", "posthog"])).toEqual([]);
  });
});
