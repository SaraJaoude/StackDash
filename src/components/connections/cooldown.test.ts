import { describe, expect, it } from "vitest";

import { cooldownRemainingSeconds, syncCooldownNotice } from "./cooldown";

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

describe("syncCooldownNotice", () => {
  it.each([
    ["no hint once the cooldown is over (boundary: zero)", 0, null],
    ["one minute for the last second (boundary: one second)", 1, "Sync now is available again in 1 minute."],
    ["one minute at exactly sixty seconds (boundary)", 60, "Sync now is available again in 1 minute."],
    ["minutes rounded up past a minute", 61, "Sync now is available again in 2 minutes."],
    ["the full cooldown", 300, "Sync now is available again in 5 minutes."],
  ])("%s", (_name, seconds, expected) => {
    expect(syncCooldownNotice(seconds)).toBe(expected);
  });
});
