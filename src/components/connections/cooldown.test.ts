import { describe, expect, it } from "vitest";

import { cooldownRemainingSeconds } from "./cooldown";

const NOW = new Date("2026-10-31T12:00:00.000Z");

describe("cooldownRemainingSeconds", () => {
  it("is zero when no sync was ever requested", () => {
    expect(cooldownRemainingSeconds(null, 300, NOW)).toBe(0);
  });

  it("counts down from the full cooldown at the moment of the request", () => {
    expect(cooldownRemainingSeconds(NOW, 300, NOW)).toBe(300);
  });

  it("rounds a partial second up so the button never unlocks early", () => {
    expect(cooldownRemainingSeconds(new Date(NOW.getTime() - 299_500), 300, NOW)).toBe(1);
  });

  it("is zero exactly at the end of the cooldown", () => {
    expect(cooldownRemainingSeconds(new Date(NOW.getTime() - 300_000), 300, NOW)).toBe(0);
  });

  it("never goes negative after the cooldown", () => {
    expect(cooldownRemainingSeconds(new Date(NOW.getTime() - 3600_000), 300, NOW)).toBe(0);
  });
});
