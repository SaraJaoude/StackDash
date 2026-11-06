import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MAX_ROWS_PER_REQUEST, readAllPages } from "./paging";

/** A query of `count` rows behind PostgREST's `.range`, which never returns more than max_rows. */
function table(count: number) {
  const rows = Array.from({ length: count }, (_, index) => index);
  const ranges: [number, number][] = [];
  const readPage = async (from: number, to: number) => {
    ranges.push([from, to]);
    return rows.slice(from, Math.min(to + 1, from + MAX_ROWS_PER_REQUEST));
  };
  return { rows, ranges, readPage };
}

describe("readAllPages", () => {
  it.each([
    { name: "empty", count: 0, ranges: [[0, 999]] },
    { name: "one short page", count: 999, ranges: [[0, 999]] },
    { name: "exactly one full page", count: 1000, ranges: [[0, 999], [1000, 1999]] },
    { name: "one row past a page", count: 1001, ranges: [[0, 999], [1000, 1999]] },
    { name: "several pages", count: 2500, ranges: [[0, 999], [1000, 1999], [2000, 2999]] },
  ])("reads every row once, in order, in pages of max_rows (boundary: $name)", async ({ count, ranges }) => {
    const query = table(count);
    const read = await readAllPages(query.readPage, 10_000);
    expect(read).toEqual({ rows: query.rows, complete: true });
    expect(query.ranges).toEqual(ranges);
  });

  it("stops at maxRows and says the read may be incomplete (boundary: more rows than the bound)", async () => {
    const query = table(3500);
    const read = await readAllPages(query.readPage, 3000);
    expect(read).toEqual({ rows: query.rows.slice(0, 3000), complete: false });
    expect(query.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("treats a read of exactly maxRows as possibly incomplete, without a further request (boundary: rows equal to the bound)", async () => {
    const query = table(3000);
    const read = await readAllPages(query.readPage, 3000);
    expect(read.complete).toBe(false);
    expect(read.rows).toHaveLength(3000);
    expect(query.ranges).toHaveLength(3);
  });

  it("asks only for the rows left under a bound that is not a whole number of pages (boundary)", async () => {
    const query = table(5000);
    const read = await readAllPages(query.readPage, 2500);
    expect(read).toEqual({ rows: query.rows.slice(0, 2500), complete: false });
    expect(query.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2499]]);
  });

  it("passes on the error of a page and reads no further (boundary: a failed request)", async () => {
    const ranges: number[] = [];
    const failing = async (from: number) => {
      ranges.push(from);
      if (from > 0) throw new Error("page failed");
      return Array.from({ length: MAX_ROWS_PER_REQUEST }, (_, index) => index);
    };
    await expect(readAllPages(failing, 10_000)).rejects.toThrow("page failed");
    expect(ranges).toEqual([0, 1000]);
  });

  it("pages at the row cap the Data API is configured with (boundary: supabase/config.toml max_rows)", () => {
    const config = readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8");
    expect(Number(/^max_rows = (\d+)$/m.exec(config)?.[1])).toBe(MAX_ROWS_PER_REQUEST);
  });
});
