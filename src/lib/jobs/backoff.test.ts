import { describe, expect, it } from "vitest";

import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  RETRY_AFTER_MAX_MS,
  backoffCeilingMs,
  backoffDelayMs,
  rateLimitDelayMs,
} from "./backoff";

describe("backoffCeilingMs", () => {
  it("doubles from the 60 s base per attempt", () => {
    expect([1, 2, 3, 4].map((attempt) => backoffCeilingMs(attempt))).toEqual([60_000, 120_000, 240_000, 480_000]);
  });

  it("stops at the 1 h cap (attempt 7 would be 64 min) and stays there for huge attempts", () => {
    expect(backoffCeilingMs(6)).toBe(BACKOFF_BASE_MS * 32);
    expect(backoffCeilingMs(7)).toBe(BACKOFF_CAP_MS);
    expect(backoffCeilingMs(5000)).toBe(BACKOFF_CAP_MS);
  });

  it("rejects attempt 0 and fractions", () => {
    expect(() => backoffCeilingMs(0)).toThrow(RangeError);
    expect(() => backoffCeilingMs(1.5)).toThrow(RangeError);
  });
});

describe("backoffDelayMs (full jitter)", () => {
  it("stays within [0, ceiling] at both ends of the random range for every attempt", () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const ceiling = backoffCeilingMs(attempt);
      expect(backoffDelayMs(attempt, () => 0)).toBe(0);
      const highest = backoffDelayMs(attempt, () => 0.999_999_999);
      expect(highest).toBeLessThanOrEqual(ceiling);
      expect(highest).toBeGreaterThanOrEqual(ceiling - 1);
      expect(highest).toBeLessThanOrEqual(BACKOFF_CAP_MS);
    }
  });

  it("rejects a random source outside [0, 1)", () => {
    expect(() => backoffDelayMs(1, () => 1)).toThrow(RangeError);
    expect(() => backoffDelayMs(1, () => -0.1)).toThrow(RangeError);
  });
});

describe("rateLimitDelayMs", () => {
  it("honors Retry-After exactly, including 0", () => {
    expect(rateLimitDelayMs(1000, 1, () => 0.5)).toBe(1000);
    expect(rateLimitDelayMs(0, 3, () => 0.5)).toBe(0);
  });

  it("clamps Retry-After to one day", () => {
    expect(rateLimitDelayMs(RETRY_AFTER_MAX_MS + 1, 1, () => 0.5)).toBe(RETRY_AFTER_MAX_MS);
  });

  it("falls back to jittered backoff without Retry-After", () => {
    expect(rateLimitDelayMs(undefined, 2, () => 0.5)).toBe(60_000);
  });
});
