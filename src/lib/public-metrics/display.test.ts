import { describe, expect, it } from "vitest";

import { applyRounding, formatMetricValue, publicationSummary, publishedDisplay } from "./display";

describe("applyRounding", () => {
  it.each([
    ["exact", 1234, 1234],
    ["tens", 1234, 1230],
    ["hundreds", 1299, 1200],
    ["thousands", 1999, 1000],
    // Boundaries: on the step stays, below the first step is zero, zero stays zero.
    ["hundreds", 1200, 1200],
    ["thousands", 999, 0],
    ["tens", 0, 0],
  ] as const)("%s rounds %d down to %d", (rounding, value, expected) => {
    expect(applyRounding(value, rounding)).toBe(expected);
  });
});

describe("formatMetricValue", () => {
  it.each([
    [1204, "stars", false, "1,204 stars"],
    [1, "deployments", false, "1 deployment"],
    [0, "signups", false, "0 signups"],
    [87, "percent", false, "87%"],
    [1200, "stars", true, "at least 1,200 stars"],
    [1, "payments", true, "at least 1 payment"],
  ] as const)("formats %d %s (at least: %s) as %s", (value, unit, atLeast, expected) => {
    expect(formatMetricValue(value, unit, atLeast)).toBe(expected);
  });
});

describe("publishedDisplay", () => {
  it("rounds down and marks a rounded value as at least", () => {
    expect(publishedDisplay(1204, "stars", "hundreds", false)).toEqual({ value: 1200, text: "at least 1,200 stars" });
  });

  it("keeps an exact value exact unless it is a lower bound", () => {
    expect(publishedDisplay(1204, "stars", "exact", false)).toEqual({ value: 1204, text: "1,204 stars" });
    expect(publishedDisplay(1000, "deployments", "exact", true)).toEqual({ value: 1000, text: "at least 1,000 deployments" });
  });
});

describe("publicationSummary", () => {
  it.each([
    ["exact", 0, "Exact, current"],
    ["hundreds", 7, "Rounded down to 100, 7 days late"],
  ] as const)("%s and %d days read %s", (rounding, delay, expected) => {
    expect(publicationSummary(rounding, delay)).toBe(expected);
  });
});
