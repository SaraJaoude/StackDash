import "server-only";

import { z } from "zod";

/*
 * Keyset pagination for the workspace lists (connections, alert rules, budgets, triggered alerts).
 * A list is ordered by a timestamp column and then `id`; the cursor is the last row's pair, base64url
 * encoded so the timestamp's `+` survives a query string. It is validated before it reaches a
 * PostgREST filter, so a crafted cursor can never add a condition.
 */

export type Page<T> = { items: T[]; nextCursor: string | null };

const MAX_CURSOR_LENGTH = 200;

const cursorSchema = z.tuple([
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/),
  // Fixture ids skip the RFC version bits, so `guid` rather than `uuid`.
  z.guid(),
]);

/** The sort timestamp exactly as the database returned it (so microseconds survive), then the id. */
export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** The decoded cursor, or null for a missing or malformed one (which then means "first page"). */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (raw === null || raw === undefined || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** PostgREST `or` filter for rows after `cursor` in ascending (`column`, id) order. */
export function afterCursorFilter(column: string, [at, id]: Cursor): string {
  return `${column}.gt."${at}",and(${column}.eq."${at}",id.gt.${id})`;
}

/** PostgREST `or` filter for rows after `cursor` in descending (`column`, id) order. */
export function beforeCursorFilter(column: string, [at, id]: Cursor): string {
  return `${column}.lt."${at}",and(${column}.eq."${at}",id.lt.${id})`;
}
