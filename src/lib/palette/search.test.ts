import { describe, expect, it } from "vitest";

import {
  isApplePlatform,
  isComposingKey,
  isTypingTarget,
  matchPaletteKey,
  matchShortcut,
  MAX_PALETTE_RESULTS,
  MAX_QUERY_LENGTH,
  paletteShortcut,
  pointerMoved,
  searchCommands,
  type PaletteCommand,
  type PaletteKey,
  type PaletteShortcut,
  type ShortcutKeyEvent,
} from "./search";

function command(id: string, label: string, keywords = ""): PaletteCommand {
  return { id, label, keywords, action: { kind: "navigate", href: `/${id}` } };
}

const COMMANDS: readonly PaletteCommand[] = [
  command("timeline", "Go to timeline", "events activity deploys"),
  command("dashboard", "Go to dashboard", "spend usage"),
  command("dashboard-vercel", "Show dashboard for provider Vercel", "vercel spend usage"),
  command("timeline-vercel-failed", "Show timeline for Vercel: Deployment failed", "vercel deployment failed events"),
  command("project-cafe", "Show dashboard for project Café"),
  command("connect-resend", "Connect Resend", "resend add provider"),
];

const ids = (commands: readonly PaletteCommand[]) => commands.map((item) => item.id);

describe("searchCommands", () => {
  it("returns every command, in order, for a blank query", () => {
    const search = searchCommands(COMMANDS, "");
    expect(ids(search.results)).toEqual(ids(COMMANDS));
    expect(search.total).toBe(COMMANDS.length);
  });

  it.each([
    ["whitespace only", "   \t "],
    ["empty", ""],
  ])("treats a %s query as blank", (_name, query) => {
    expect(searchCommands(COMMANDS, query).total).toBe(COMMANDS.length);
  });

  it("matches every word in any order, in the label or the keywords", () => {
    expect(ids(searchCommands(COMMANDS, "failed vercel").results)).toEqual(["timeline-vercel-failed"]);
    expect(ids(searchCommands(COMMANDS, "deploys").results)).toEqual(["timeline"]);
  });

  it("finds nothing when one word matches nothing", () => {
    const search = searchCommands(COMMANDS, "vercel nonexistent");
    expect(search.results).toEqual([]);
    expect(search.total).toBe(0);
  });

  it("ignores case, accents, and repeated spaces", () => {
    expect(ids(searchCommands(COMMANDS, "  CAFE  ").results)).toEqual(["project-cafe"]);
    expect(ids(searchCommands(COMMANDS, "connect    RESEND").results)).toEqual(["connect-resend"]);
  });

  it("ranks a label starting with the query first, then a word starting with it, then the rest", () => {
    // Listed worst first, so the ranking, not the list order, decides.
    const commands = [
      command("keyword-only", "Go to alerts", "dashboard thresholds"),
      command("word", "Go to dashboard"),
      command("prefix", "Dashboard home"),
    ];
    expect(ids(searchCommands(commands, "dash").results)).toEqual(["prefix", "word", "keyword-only"]);
  });

  it("caps the results at the limit and still counts every match", () => {
    const many = Array.from({ length: MAX_PALETTE_RESULTS + 1 }, (_, index) => command(`a${index}`, `Account ${index}`));
    const search = searchCommands(many, "account");
    expect(search.results).toHaveLength(MAX_PALETTE_RESULTS);
    expect(search.total).toBe(MAX_PALETTE_RESULTS + 1);
    expect(searchCommands(many, "account", 1).results).toHaveLength(1);
  });

  it("searches only the first MAX_QUERY_LENGTH characters of a very long query", () => {
    const long = `vercel${" ".repeat(MAX_QUERY_LENGTH)}nonexistent`;
    expect(searchCommands(COMMANDS, long).total).toBe(2);
  });

  it("handles an empty command list", () => {
    expect(searchCommands([], "anything")).toEqual({ results: [], total: 0 });
    expect(searchCommands([], "")).toEqual({ results: [], total: 0 });
  });
});

// keyCode 75 is K; 229 is what a browser reports for a key the IME processed.
const KEY: ShortcutKeyEvent = {
  key: "k",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 75,
};

describe("isComposingKey", () => {
  it("is false for a key outside a composition", () => {
    expect(isComposingKey({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("is true mid-composition", () => {
    expect(isComposingKey({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it("is true for the press that ends a composition, which some browsers send with isComposing false", () => {
    expect(isComposingKey({ isComposing: false, keyCode: 229 })).toBe(true);
  });
});

describe("matchShortcut", () => {
  it.each<[string, Partial<ShortcutKeyEvent>, boolean, PaletteShortcut]>([
    ["Cmd+K on Apple", { metaKey: true }, true, "palette"],
    ["Ctrl+K elsewhere", { ctrlKey: true }, false, "palette"],
    ["Cmd+K with Caps Lock on", { key: "K", metaKey: true }, true, "palette"],
    ["? with Shift", { key: "?", shiftKey: true }, true, "shortcuts"],
    ["? without Shift (a layout with a ? key)", { key: "?" }, false, "shortcuts"],
  ])("opens for %s", (_name, overrides, apple, expected) => {
    expect(matchShortcut({ ...KEY, ...overrides }, apple)).toBe(expected);
  });

  it.each<[string, Partial<ShortcutKeyEvent>, boolean]>([
    ["Ctrl+K on Apple", { ctrlKey: true }, true],
    ["Cmd+K elsewhere (the Windows key)", { metaKey: true }, false],
    ["Cmd+Ctrl+K on Apple", { metaKey: true, ctrlKey: true }, true],
    ["Cmd+Shift+K", { metaKey: true, shiftKey: true }, true],
    ["Ctrl+Alt+K", { ctrlKey: true, altKey: true }, false],
    ["K alone", {}, true],
    ["Cmd+K mid-composition", { metaKey: true, isComposing: true }, true],
    ["Cmd+K ending a composition (keyCode 229)", { metaKey: true, keyCode: 229 }, true],
    ["? ending a composition (keyCode 229)", { key: "?", shiftKey: true, keyCode: 229 }, true],
    ["Cmd+?", { key: "?", metaKey: true }, true],
    ["Ctrl+?", { key: "?", ctrlKey: true }, false],
    ["Alt+?", { key: "?", altKey: true }, false],
    ["/", { key: "/" }, false],
  ])("ignores %s", (_name, overrides, apple) => {
    expect(matchShortcut({ ...KEY, ...overrides }, apple)).toBeNull();
  });
});

describe("matchPaletteKey", () => {
  it.each<[string, number, PaletteKey]>([
    ["ArrowDown", 40, "next"],
    ["ArrowUp", 38, "previous"],
    ["Enter", 13, "choose"],
  ])("maps %s", (key, keyCode, expected) => {
    expect(matchPaletteKey({ key, keyCode, isComposing: false })).toBe(expected);
  });

  it.each([
    ["Enter committing an IME composition", { key: "Enter", keyCode: 13, isComposing: true }],
    ["ArrowDown moving through IME candidates", { key: "ArrowDown", keyCode: 40, isComposing: true }],
    ["ArrowUp moving through IME candidates", { key: "ArrowUp", keyCode: 38, isComposing: true }],
    ["Enter ending a composition (keyCode 229)", { key: "Enter", keyCode: 229, isComposing: false }],
    ["a letter", { key: "a", keyCode: 65, isComposing: false }],
    ["Escape, which the dialog handles", { key: "Escape", keyCode: 27, isComposing: false }],
    ["Tab, which the dialog handles", { key: "Tab", keyCode: 9, isComposing: false }],
  ])("leaves %s to the field", (_name, event) => {
    expect(matchPaletteKey(event)).toBeNull();
  });
});

describe("pointerMoved", () => {
  it("is true for the first pointer event", () => {
    expect(pointerMoved(null, { x: 0, y: 0 })).toBe(true);
  });

  it.each([
    ["across", { x: 101, y: 200 }],
    ["down", { x: 100, y: 201 }],
    ["to the origin", { x: 0, y: 0 }],
  ])("is true when the pointer moves %s", (_name, next) => {
    expect(pointerMoved({ x: 100, y: 200 }, next)).toBe(true);
  });

  it("is false when content scrolls under a resting pointer (same position)", () => {
    expect(pointerMoved({ x: 100, y: 200 }, { x: 100, y: 200 })).toBe(false);
  });

  it("compares fractional positions exactly", () => {
    expect(pointerMoved({ x: 100.5, y: 200.25 }, { x: 100.5, y: 200.25 })).toBe(false);
    expect(pointerMoved({ x: 100.5, y: 200.25 }, { x: 100.5, y: 200.5 })).toBe(true);
  });
});

describe("isTypingTarget", () => {
  it.each([
    ["a text input", { tagName: "INPUT", isContentEditable: false }],
    ["a checkbox (any input counts)", { tagName: "INPUT", type: "checkbox", isContentEditable: false }],
    ["a textarea", { tagName: "TEXTAREA", isContentEditable: false }],
    ["a select", { tagName: "SELECT", isContentEditable: false }],
    ["a lowercase tag name (XHTML)", { tagName: "input", isContentEditable: false }],
    ["editable content", { tagName: "DIV", isContentEditable: true }],
  ])("is true for %s", (_name, target) => {
    expect(isTypingTarget(target)).toBe(true);
  });

  it.each([
    ["a button", { tagName: "BUTTON", isContentEditable: false }],
    ["the body", { tagName: "BODY", isContentEditable: false }],
    ["a link", { tagName: "A", isContentEditable: false }],
    ["null", null],
    ["undefined", undefined],
    ["a non-element target (window)", {}],
    ["a tag name that is not a string", { tagName: 42 }],
  ])("is false for %s", (_name, target) => {
    expect(isTypingTarget(target)).toBe(false);
  });
});

describe("platform", () => {
  it.each([
    ["Macintosh", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15", true],
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", true],
    ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", false],
    ["Linux", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", false],
    ["empty", "", false],
  ])("detects %s", (_name, userAgent, expected) => {
    expect(isApplePlatform(userAgent)).toBe(expected);
  });

  it("labels the shortcut for each platform", () => {
    expect(paletteShortcut(true)).toEqual({ label: "⌘ K", aria: "Meta+K" });
    expect(paletteShortcut(false)).toEqual({ label: "Ctrl K", aria: "Control+K" });
  });
});
