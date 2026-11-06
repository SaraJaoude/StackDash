/**
 * Most rows the Data API returns for one request: `max_rows` in supabase/config.toml, which is also
 * the Supabase hosted default. PostgREST cuts a longer read to this many rows without an error, so a
 * larger `.limit()` is never reached and a cut read looks complete (#209).
 */
export const MAX_ROWS_PER_REQUEST = 1000;

export type PagedRows<Row> = Readonly<{
  rows: Row[];
  /** False when the read stopped at `maxRows` with every page full, so more rows may exist. */
  complete: boolean;
}>;

/**
 * Every row of one query, read in pages of at most MAX_ROWS_PER_REQUEST rows, up to `maxRows`.
 * `readPage(from, to)` returns rows `from` to `to`, both included (PostgREST's `.range`), of a query
 * whose order ends with a unique column, so consecutive pages neither skip nor repeat a row. Pages
 * are read one after another, because each is needed only when the one before it came back full.
 * The caller decides what an incomplete read means and logs it.
 */
export async function readAllPages<Row>(
  readPage: (from: number, to: number) => PromiseLike<readonly Row[]>,
  maxRows: number,
): Promise<PagedRows<Row>> {
  const rows: Row[] = [];
  while (rows.length < maxRows) {
    const size = Math.min(MAX_ROWS_PER_REQUEST, maxRows - rows.length);
    const page = await readPage(rows.length, rows.length + size - 1);
    rows.push(...page);
    if (page.length < size) return { rows, complete: true };
  }
  return { rows, complete: false };
}
