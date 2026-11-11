import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/*
 * Test only. A fake PostgREST that behaves like the real one on the point the paged reads depend
 * on: it answers at most `max_rows` (1000, supabase/config.toml) rows per request, whatever
 * `limit` asks for, and says nothing about the rows it left out (#209). The client is the real
 * supabase-js client with `fetch` replaced, so a store's queries are the ones it sends in
 * production. It knows the filters `eq`, `neq`, `gte`, `lt`, `lte`, `in`, `is.null`, and
 * `not.is.null`, `order` (asc or desc per column), `offset`, `limit`, and `select` by column name;
 * any other query fails as PostgREST would rather than answer wrongly. Each answered request is
 * recorded with its filters, so a test can check what a read asked for, not only how many rows.
 */

export const MAX_ROWS = 1000;

export type Cell = string | number | boolean | null | readonly string[];
export type Row = Readonly<Record<string, Cell>>;
/** One filter as sent: the column and its PostgREST operator and operand, such as `["snapshot_date", "gte.2026-09-27"]`. */
export type Filter = readonly [column: string, filter: string];
export type PageRequest = Readonly<{ table: string; filters: readonly Filter[]; offset: number; limit: number | null; returned: number }>;

/** The values of a PostgREST `in.(...)` list; postgrest-js quotes a value only when it must. */
function inList(rest: string): Set<string> {
  const inner = rest.replace(/^\(/, "").replace(/\)$/, "");
  return new Set([...inner.matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)].map((match) => match[1] ?? match[2] ?? ""));
}

/** One PostgREST filter (`eq.x`, `in.(a,b)`, `not.is.null`, ...) as a test on a cell, or null when the fake does not know it. */
function predicate(filter: string): ((value: string | null) => boolean) | null {
  if (filter === "is.null") return (value) => value === null;
  if (filter === "not.is.null") return (value) => value !== null;
  const dot = filter.indexOf(".");
  const operand = filter.slice(dot + 1);
  switch (filter.slice(0, dot)) {
    case "eq":
      return (value) => value === operand;
    case "neq":
      return (value) => value !== null && value !== operand;
    case "gte":
      return (value) => value !== null && value >= operand;
    case "lt":
      return (value) => value !== null && value < operand;
    case "lte":
      return (value) => value !== null && value <= operand;
    case "in": {
      const values = inList(operand);
      return (value) => value !== null && values.has(value);
    }
    default:
      return null;
  }
}

function compareBy(order: string): (a: Row, b: Row) => number {
  const keys = order.split(",").map((part) => {
    const [column = "", direction = "asc"] = part.split(".");
    return { column, sign: direction === "desc" ? -1 : 1 };
  });
  return (a, b) => {
    for (const { column, sign } of keys) {
      const left = String(a[column]);
      const right = String(b[column]);
      if (left !== right) return left < right ? -sign : sign;
    }
    return 0;
  };
}

const RESERVED: Readonly<Record<string, true>> = { select: true, order: true, limit: true, offset: true };

/** A Supabase client over in-memory tables that, like PostgREST, returns at most MAX_ROWS rows a request. */
export function fakeSupabase(tables: Readonly<Record<string, readonly Row[]>>) {
  const requests: PageRequest[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split("/").at(-1) ?? "";
    const source = tables[table];
    const sent = [...url.searchParams].flatMap(([column, filter]): Filter[] => (RESERVED[column] === true ? [] : [[column, filter]]));
    const filters = sent.map(([column, filter]) => ({ column, test: predicate(filter) }));
    // A query the fake cannot answer fails as PostgREST would, rather than answer wrongly.
    if (source === undefined || filters.some((filter) => filter.test === null)) {
      return new Response(JSON.stringify({ message: `The fake PostgREST cannot answer ${url.search} on ${table}` }), { status: 400 });
    }
    let rows = source.filter((row) =>
      filters.every(({ column, test }) => {
        const cell = row[column];
        return test?.(cell === undefined || cell === null ? null : String(cell)) === true;
      }),
    );
    const order = url.searchParams.get("order");
    if (order !== null) rows = rows.toSorted(compareBy(order));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam === null ? null : Number(limitParam);
    // max_rows: whatever the request asked for, never more than this, and no error.
    const page = rows.slice(offset, offset + Math.min(limit ?? MAX_ROWS, MAX_ROWS));
    const columns = (url.searchParams.get("select") ?? "*").split(",");
    const body = page.map((row) => (columns[0] === "*" ? row : Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))));
    requests.push({ table, filters: sent, offset, limit, returned: body.length });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const db = createClient<Database>("http://postgrest.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch },
  });
  return { db, requests };
}
