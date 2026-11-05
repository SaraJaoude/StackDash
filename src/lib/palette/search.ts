/**
 * The command palette's client-side half (#170): what a command is, how a query narrows the list,
 * and which key presses open the palette or the shortcut list. Pure and client-safe, so every rule
 * is unit tested and the palette searches in memory: typing never reaches the server.
 */

export type PaletteAction = Readonly<{ kind: "navigate"; href: string }> | Readonly<{ kind: "shortcuts" }>;

export type PaletteCommand = Readonly<{
  /** Stable and unique within one list, for React keys. */
  id: string;
  /** What choosing it does, in words: "Go to dashboard", "Connect Vercel". */
  label: string;
  /** Extra words it matches but does not show, such as the provider id or "spend". */
  keywords: string;
  action: PaletteAction;
}>;

/** Most results the list renders; a workspace can hold over a thousand accounts. */
export const MAX_PALETTE_RESULTS = 50;

/** Longest query that is searched; the rest is ignored. */
export const MAX_QUERY_LENGTH = 100;

// Case and accents never decide a match: "resend" finds "Resend", "cafe" finds "Café".
function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US");
}

export type PaletteSearch = Readonly<{
  /** At most `limit` matches, best first. */
  results: readonly PaletteCommand[];
  /** Every match, including the ones past `limit`. */
  total: number;
}>;

/**
 * Commands matching every word of `query` in their label or keywords, in any order. A label that
 * starts with the query ranks first, then a label with a word starting with the query's first
 * word, then the rest; ties keep the list's own order. A blank query matches everything.
 */
export function searchCommands(
  commands: readonly PaletteCommand[],
  query: string,
  limit: number = MAX_PALETTE_RESULTS,
): PaletteSearch {
  const needle = normalize(query.slice(0, MAX_QUERY_LENGTH)).trim().replace(/\s+/g, " ");
  if (needle === "") return { results: commands.slice(0, limit), total: commands.length };
  const tokens = needle.split(" ");
  const firstToken = tokens[0] ?? needle;

  const matches: { command: PaletteCommand; rank: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = normalize(command.label);
    const haystack = `${label} ${normalize(command.keywords)}`;
    if (!tokens.every((token) => haystack.includes(token))) return;
    const rank = label.startsWith(needle) ? 0 : label.split(" ").some((word) => word.startsWith(firstToken)) ? 1 : 2;
    matches.push({ command, rank, index });
  });
  matches.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return { results: matches.slice(0, limit).map(({ command }) => command), total: matches.length };
}

export type PaletteShortcut = "palette" | "shortcuts";

export type ShortcutKeyEvent = Readonly<Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">>;

/**
 * The shortcut a key press asks for: Cmd+K on Apple platforms and Ctrl+K elsewhere open the
 * palette, `?` opens the shortcut list. The other modifier, Alt, or Shift with K is someone
 * else's shortcut and is left alone, and so is a key pressed mid-composition (an IME).
 */
export function matchShortcut(event: ShortcutKeyEvent, apple: boolean): PaletteShortcut | null {
  if (event.isComposing || event.altKey) return null;
  if (event.key.toLowerCase() === "k" && !event.shiftKey) {
    const primary = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    return primary ? "palette" : null;
  }
  // `?` needs Shift on most layouts, so Shift is allowed here and only the command keys are not.
  if (event.key === "?" && !event.metaKey && !event.ctrlKey) return "shortcuts";
  return null;
}

/**
 * True when key presses on `target` are typing: any input, a textarea, a select (type-ahead), or
 * editable content. Shortcuts never fire there, whatever the input's type. Duck-typed so it is
 * testable without a DOM.
 */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  if ("isContentEditable" in target && target.isContentEditable === true) return true;
  if (!("tagName" in target) || typeof target.tagName !== "string") return false;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Apple platforms use Cmd for the shortcut. iPadOS reports itself as a Mac, which is right here. */
export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

/** The palette shortcut as printed on a key cap, and in `aria-keyshortcuts` syntax. */
export function paletteShortcut(apple: boolean): Readonly<{ label: string; aria: string }> {
  return apple ? { label: "⌘ K", aria: "Meta+K" } : { label: "Ctrl K", aria: "Control+K" };
}
