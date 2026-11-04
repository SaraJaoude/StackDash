import { describe, expect, it } from "vitest";

import { afterCursorFilter, beforeCursorFilter, decodeCursor, encodeCursor, type Cursor } from "./cursor";

const CURSOR: Cursor = ["2026-10-31T09:15:00.123456+00:00", "11111111-1111-4111-8111-111111111111"];

describe("encodeCursor and decodeCursor", () => {
  it("round-trips a timestamp with microseconds and an id", () => {
    const token = encodeCursor(CURSOR);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(CURSOR);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["too long", "a".repeat(201)],
    ["not base64url JSON", "not-a-cursor"],
    ["a non-timestamp", encodeCursor(["yesterday", CURSOR[1]])],
    ["a non-id", encodeCursor([CURSOR[0], "1 or 1=1"])],
    ["a filter injection in the timestamp", encodeCursor([`${CURSOR[0]}",id.gt.0`, CURSOR[1]])],
  ])("treats a %s cursor as the first page", (_, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("cursor filters", () => {
  it("selects rows after the cursor in ascending order", () => {
    expect(afterCursorFilter("created_at", CURSOR)).toBe(
      `created_at.gt."${CURSOR[0]}",and(created_at.eq."${CURSOR[0]}",id.gt.${CURSOR[1]})`,
    );
  });

  it("selects rows after the cursor in descending order", () => {
    expect(beforeCursorFilter("triggered_at", CURSOR)).toBe(
      `triggered_at.lt."${CURSOR[0]}",and(triggered_at.eq."${CURSOR[0]}",id.lt.${CURSOR[1]})`,
    );
  });
});
