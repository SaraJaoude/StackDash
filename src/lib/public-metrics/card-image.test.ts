import { describe, expect, it } from "vitest";

import { trendPath } from "./card-image";

describe("trendPath", () => {
  it("draws from the oldest point on the left to the newest on the right, higher values higher up", () => {
    expect(trendPath([0, 5, 10], 100, 50)).toBe("M0 45 L50 25 L100 5");
  });

  it("breaks the line at a missing day instead of drawing across the gap", () => {
    expect(trendPath([0, null, 10, 10], 90, 50)).toBe("M0 45 M60 5 L90 5");
  });

  it("draws a flat series at mid height (boundary: no change at all)", () => {
    expect(trendPath([7, 7, 7], 100, 50)).toBe("M0 25 L50 25 L100 25");
  });

  it.each([
    ["no points", []],
    ["one point", [3]],
    ["one known point among gaps", [null, 3, null]],
    ["only gaps", [null, null]],
  ])("draws nothing for %s, since that is not a trend", (_title, values) => {
    expect(trendPath(values, 100, 50)).toBeNull();
  });
});
