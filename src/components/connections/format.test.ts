import { describe, expect, it } from "vitest";

import { cooldownRemainingSeconds, formatAbsolute, formatRelative } from "./format";

const NOW = new Date("2026-10-31T12:00:00.000Z");

describe("formatAbsolute", () => {
  it("shows London time, which is GMT after the October clock change", () => {
    expect(formatAbsolute(new Date("2026-10-31T14:05:00.000Z"))).toMatch(/^Oct 31, 2026, 2:05\sPM$/);
  });

  it("shows London summer time an hour ahead of UTC", () => {
    expect(formatAbsolute(new Date("2026-07-01T14:05:00.000Z"))).toMatch(/^Jul 1, 2026, 3:05\sPM$/);
  });
});

describe("formatRelative", () => {
  it("says now for 44 seconds ago", () => {
    expect(formatRelative(new Date(NOW.getTime() - 44_000), NOW)).toBe("now");
  });

  it("counts seconds from 45 seconds ago", () => {
    expect(formatRelative(new Date(NOW.getTime() - 45_000), NOW)).toBe("45 seconds ago");
  });

  it("says 5 minutes ago", () => {
    expect(formatRelative(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5 minutes ago");
  });

  it("says yesterday for one day ago", () => {
    expect(formatRelative(new Date(NOW.getTime() - 24 * 3600_000), NOW)).toBe("yesterday");
  });

  it("handles a future time", () => {
    expect(formatRelative(new Date(NOW.getTime() + 2 * 3600_000), NOW)).toBe("in 2 hours");
  });
});

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
