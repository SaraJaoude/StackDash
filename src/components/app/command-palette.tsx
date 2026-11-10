"use client";

import { useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { syncNow } from "@/app/w/[workspace]/connections/actions";
import { SearchIcon } from "@/components/icons";
import {
  isApplePlatform,
  isTypingTarget,
  matchPaletteKey,
  matchShortcut,
  MAX_QUERY_LENGTH,
  paletteShortcut,
  pointerMoved,
  searchCommands,
  type PaletteAction,
  type PaletteCommand,
  type PaletteSearch,
  type PointerPosition,
} from "@/lib/palette/search";

const noSubscribe = () => () => {};

/** The platform never changes while the page is open. The server renders the Ctrl label. */
function useApplePlatform(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => isApplePlatform(navigator.userAgent),
    () => false,
  );
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * Wraps Tab and Shift+Tab inside a modal dialog. `showModal()` makes the page behind it inert, but
 * Chromium still lets Tab leave the last control for the browser's own UI.
 */
function trapTab(event: ReactKeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const count = new Intl.NumberFormat("en-US");

function resultStatus(search: PaletteSearch, query: string): string {
  if (search.total === 0) {
    return `No commands match "${query.trim()}". Try a page, action, workspace, provider, project, or account name.`;
  }
  if (search.results.length < search.total) {
    return `Showing ${count.format(search.results.length)} of ${count.format(search.total)} results. Type more to narrow the list.`;
  }
  return `${count.format(search.total)} ${search.total === 1 ? "result" : "results"}`;
}

/** What an action run from the palette is doing, or how it ended, in words for its live region. */
type ActionOutcome = Readonly<{ tone: "pending" | "success" | "error"; message: string }>;

/**
 * Queues a sync through the connection page's own Server Action, which authorizes the caller and
 * words every result, so the palette adds only the case where the request never got an answer.
 */
async function syncConnection(
  workspaceSlug: string,
  action: Extract<PaletteAction, { kind: "sync" }>,
): Promise<ActionOutcome> {
  const formData = new FormData();
  formData.set("workspace", workspaceSlug);
  formData.append("connectionId", action.connectionId);
  try {
    const result = await syncNow(null, formData);
    if (result.ok) return { tone: "success", message: result.message ?? `Sync queued for ${action.name}.` };
    const reference = result.referenceId === undefined ? "" : ` Reference ${result.referenceId}.`;
    return { tone: "error", message: `${result.message}${reference}` };
  } catch {
    // A rejected Server Action means the request or its response was lost on the way; the server
    // logs its own failures, so all the palette can add is the next step.
    return {
      tone: "error",
      message: `The sync for ${action.name} could not be requested because DevMacro did not answer. Check your connection, then try again.`,
    };
  }
}

const KBD = "rounded border border-line-strong bg-panel-raised px-1.5 font-mono text-[11px] leading-5 text-foreground";

function ArrowKeys() {
  return (
    <>
      <kbd className={KBD}>
        <span aria-hidden="true">↑</span>
        <span className="sr-only">Up arrow</span>
      </kbd>{" "}
      <kbd className={KBD}>
        <span aria-hidden="true">↓</span>
        <span className="sr-only">Down arrow</span>
      </kbd>
    </>
  );
}

const SECONDARY_BUTTON =
  "inline-flex min-h-9 items-center rounded-md border border-line-strong px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground";

/**
 * The workspace command palette (#170): a button in the shell, Cmd+K or Ctrl+K, and `?` for the
 * shortcut list. Both are native modal dialogs, like the repository's confirm dialogs: focus moves
 * in on open, stays in while open, returns to where it was on close, and Escape closes. The
 * results follow the ARIA combobox pattern with a listbox popup: focus stays in the input and
 * `aria-activedescendant` names the selected result, so a screen reader announces it.
 *
 * `commands` arrive from the server already built; filtering happens here, in memory.
 */
export function CommandPalette({
  workspaceSlug,
  commands,
  notice,
}: {
  /** The workspace the actions run in; each Server Action checks the member's role there again. */
  workspaceSlug: string;
  commands: readonly PaletteCommand[];
  /** Shown above the results when part of the list could not be loaded. */
  notice: string | null;
}) {
  const router = useRouter();
  const apple = useApplePlatform();
  const shortcut = paletteShortcut(apple);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [running, startRunning] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutsRef = useRef<HTMLDialogElement>(null);
  const shortcutsCloseRef = useRef<HTMLButtonElement>(null);
  // Where focus goes back to on close: the trigger, or whatever was focused when a shortcut fired.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // "Show keyboard shortcuts" closes the palette and opens the list without returning focus first.
  const shortcutsNextRef = useRef(false);
  // Where the pointer last was over the results, so a row scrolling under a resting pointer does
  // not take the selection from the arrow keys.
  const pointerRef = useRef<PointerPosition | null>(null);
  const titleId = useId();
  const inputId = useId();
  const listboxId = useId();
  const noticeId = useId();
  const shortcutsTitleId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  // Only searched while open; a closed palette renders no results.
  const search = open ? searchCommands(commands, query) : null;
  const results = search?.results ?? [];
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const hasResults = results.length > 0;

  function rememberFocus(): void {
    const current = document.activeElement;
    returnFocusRef.current = current instanceof HTMLElement && current !== document.body ? current : null;
  }

  function restoreFocus(): void {
    // A late close event (see onPaletteClose) must not take the return target from a dialog that
    // has opened since; that dialog's own close restores focus.
    if (paletteRef.current?.open === true || shortcutsRef.current?.open === true) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    (target !== null && target.isConnected ? target : buttonRef.current)?.focus();
  }

  function openPalette(): void {
    rememberFocus();
    setQuery("");
    setActive(0);
    setOutcome(null);
    setOpen(true);
    paletteRef.current?.showModal();
    inputRef.current?.focus();
  }

  function openShortcuts(): void {
    shortcutsRef.current?.showModal();
    shortcutsCloseRef.current?.focus();
  }

  function onPaletteClose(): void {
    // Chromium hides a closing dialog and returns focus at once but fires `close` on the next
    // animation frame, so a shortcut pressed before that frame reopens the palette first. The
    // event then belongs to the earlier close and must not empty the open palette's results (#225),
    // and a shortcut list request made by that close is dropped with it: the user reopened the
    // palette instead, and its own close must not open the list.
    if (paletteRef.current?.open === true) {
      shortcutsNextRef.current = false;
      return;
    }
    setOpen(false);
    if (shortcutsNextRef.current) {
      shortcutsNextRef.current = false;
      openShortcuts();
      return;
    }
    restoreFocus();
  }

  function choose(command: PaletteCommand): void {
    const { action } = command;
    // An action runs with the palette open, so its result is announced where focus already is.
    if (action.kind === "sync") {
      if (running) return;
      setOutcome({ tone: "pending", message: `Queueing a sync for ${action.name}.` });
      startRunning(async () => setOutcome(await syncConnection(workspaceSlug, action)));
      return;
    }
    if (action.kind === "shortcuts") shortcutsNextRef.current = true;
    if (action.kind === "navigate") {
      // A result for part of this page (Create API key, chosen on settings) leaves focus there:
      // navigating within the page mounts nothing new that could take it.
      const destination = new URL(action.href, window.location.href);
      const target =
        destination.hash !== "" && destination.pathname === window.location.pathname
          ? document.getElementById(destination.hash.slice(1))
          : null;
      if (target !== null) returnFocusRef.current = target;
    }
    paletteRef.current?.close();
    if (action.kind === "navigate") router.push(action.href);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    // `nativeEvent` carries `isComposing`; mid-composition keys belong to the IME, not the palette.
    const key = matchPaletteKey(event.nativeEvent);
    if (key === "next" || key === "previous") {
      event.preventDefault();
      if (!hasResults) return;
      const step = key === "next" ? 1 : -1;
      setActive((activeIndex + step + results.length) % results.length);
    } else if (key === "choose") {
      const command = results[activeIndex];
      if (command === undefined) return;
      event.preventDefault();
      choose(command);
    }
  }

  // A row selects on hover only when the pointer moves over it. Entering records the position
  // without selecting, so a row that scrolls under a resting pointer (the arrow keys scrolled the
  // list) keeps the keyboard's selection; the next real movement selects it.
  function onOptionPointerEnter(event: ReactPointerEvent<HTMLLIElement>): void {
    pointerRef.current = { x: event.clientX, y: event.clientY };
  }

  function onOptionPointerMove(event: ReactPointerEvent<HTMLLIElement>, index: number): void {
    const next = { x: event.clientX, y: event.clientY };
    const moved = pointerMoved(pointerRef.current, next);
    pointerRef.current = next;
    if (moved) setActive(index);
  }

  const onDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    const requested = matchShortcut(event, apple);
    if (requested === null) return;
    // One modal at a time: an open confirm dialog, the palette, or the list keeps the keys.
    if (document.querySelector("dialog[open]") !== null) return;
    event.preventDefault();
    if (requested === "palette") {
      openPalette();
    } else {
      rememberFocus();
      openShortcuts();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onDocumentKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  // Keeps the selected result visible while the arrow keys move through a long list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listboxId]);

  const shortcutRows: readonly Readonly<{ keys: ReactNode; description: string }>[] = [
    { keys: <kbd className={KBD}>{shortcut.label}</kbd>, description: "Open the command palette" },
    { keys: <kbd className={KBD}>?</kbd>, description: "Show this list of shortcuts" },
    { keys: <ArrowKeys />, description: "Move through the palette's results" },
    { keys: <kbd className={KBD}>Enter</kbd>, description: "Open or run the selected result" },
    { keys: <kbd className={KBD}>Esc</kbd>, description: "Close the palette or this list" },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts={shortcut.aria}
        onClick={openPalette}
        className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-foreground"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="sr-only sm:not-sr-only">Jump to</span>
        <kbd aria-hidden="true" className={`hidden md:inline ${KBD}`}>
          {shortcut.label}
        </kbd>
      </button>

      <dialog
        ref={paletteRef}
        aria-labelledby={titleId}
        aria-describedby={notice === null ? undefined : noticeId}
        onClose={onPaletteClose}
        onKeyDown={trapTab}
        className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border border-line-strong bg-panel p-0 text-foreground shadow-xl shadow-black/40 backdrop:bg-black/60"
      >
        <h2 id={titleId} className="sr-only">
          Command palette
        </h2>
        <div className="flex items-center gap-3 border-b border-line px-4 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted" />
          <label htmlFor={inputId} className="sr-only">
            Search commands
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={hasResults}
            aria-controls={hasResults ? listboxId : undefined}
            aria-activedescendant={hasResults ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Search pages, actions, workspaces, providers, and accounts"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="min-h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <button type="button" onClick={() => paletteRef.current?.close()} className={SECONDARY_BUTTON}>
            Close
          </button>
        </div>

        {notice === null ? null : (
          <p id={noticeId} className="border-b border-line px-4 py-2 text-sm text-warning">
            {notice}
          </p>
        )}

        {/* Always mounted, so screen readers announce every change: progress and success politely,
            a failure at once. */}
        <div role="status" aria-live="polite" className="text-sm">
          {outcome === null || outcome.tone === "error" ? null : (
            <p className={`border-b border-line px-4 py-2 ${outcome.tone === "success" ? "text-success" : "text-muted"}`}>
              {outcome.message}
            </p>
          )}
        </div>
        <div role="alert" aria-live="assertive" className="text-sm">
          {outcome?.tone === "error" ? <p className="border-b border-line px-4 py-2 text-danger">{outcome.message}</p> : null}
        </div>

        {hasResults ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Commands"
            // Clicking a result must not move focus out of the input, or the combobox loses it.
            onMouseDown={(event) => event.preventDefault()}
            className="max-h-[50vh] overflow-y-auto p-1.5"
          >
            {results.map((command, index) => {
              const selected = index === activeIndex;
              return (
                <li
                  key={command.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(command)}
                  onPointerEnter={onOptionPointerEnter}
                  onPointerMove={(event) => onOptionPointerMove(event, index)}
                  className={`flex min-h-9 cursor-pointer items-center gap-3 rounded-md border px-3 py-1.5 text-sm ${
                    selected ? "border-line-strong bg-panel-raised text-foreground" : "border-transparent text-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 break-words">{command.label}</span>
                  {/* The kind is part of the option's name, after a pause, so a screen reader tells
                      "Stripe, Provider dashboard" from "Stripe, Provider timeline". */}
                  <span className="shrink-0 text-xs text-muted">
                    <span className="sr-only">, </span>
                    {command.kind}
                  </span>
                  {/* Shape as well as color marks the selection. */}
                  {selected ? (
                    <kbd aria-hidden="true" className={`shrink-0 ${KBD}`}>
                      Enter
                    </kbd>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted">
          <p role="status" aria-live="polite">
            {search === null ? null : resultStatus(search, query)}
          </p>
          <p aria-hidden="true" className="hidden sm:block">
            <ArrowKeys /> to move, <kbd className={KBD}>Enter</kbd> to choose, <kbd className={KBD}>Esc</kbd> to close
          </p>
        </div>
      </dialog>

      <dialog
        ref={shortcutsRef}
        aria-labelledby={shortcutsTitleId}
        onClose={restoreFocus}
        onKeyDown={trapTab}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-panel p-6 text-foreground backdrop:bg-black/60"
      >
        <h2 id={shortcutsTitleId} className="text-lg font-semibold tracking-tight">
          Keyboard shortcuts
        </h2>
        <p className="mt-1 text-sm text-muted">Shortcuts do nothing while you are typing in a field.</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {shortcutRows.map(({ keys, description }) => (
            <Fragment key={description}>
              <dt className="whitespace-nowrap">{keys}</dt>
              <dd>{description}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="mt-6 flex justify-end">
          <button
            ref={shortcutsCloseRef}
            type="button"
            onClick={() => shortcutsRef.current?.close()}
            className={SECONDARY_BUTTON}
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
