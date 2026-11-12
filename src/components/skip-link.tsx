"use client";

/** The parts of the target element a skip touches; an HTMLElement fits, so does a test stand-in. */
export type SkipTarget = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: "focus" | "blur", listener: () => void, options: { once: true }): void;
  focus(): void;
};

/**
 * Set on a skip target while the skip's focus is on it. `globals.css` drops the focus outline for
 * it: a skip target is a landmark or a block of text, not a control, so it is not outlined like one
 * and every skip link lands the same way (decided on #191, as GOV.UK Frontend's skip link does with
 * `govuk-skip-link-focused-element`). The next Tab reaches an outlined control.
 */
export const SKIP_FOCUSED_ATTRIBUTE = "data-skip-focused";

/**
 * Moves keyboard focus onto the skip link's target, so the next Tab continues inside the content
 * rather than back at the page navigation (#103). A landmark only takes focus with a tabindex, and
 * a permanent one would let every click inside it focus it, which restarts Tab at its first
 * control. So the tabindex is added for the skip and removed when focus leaves, as GOV.UK Frontend's
 * skip link does (`setFocus` in `govuk/common/index.mjs`), together with `SKIP_FOCUSED_ATTRIBUTE`.
 */
export function focusSkipTarget(target: SkipTarget): void {
  const addsTabindex = target.getAttribute("tabindex") === null;
  if (addsTabindex) target.setAttribute("tabindex", "-1");
  target.setAttribute(SKIP_FOCUSED_ATTRIBUTE, "");
  target.addEventListener(
    "focus",
    () =>
      target.addEventListener(
        "blur",
        () => {
          target.removeAttribute(SKIP_FOCUSED_ATTRIBUTE);
          if (addsTabindex) target.removeAttribute("tabindex");
        },
        { once: true },
      ),
    { once: true },
  );
  target.focus();
}

/**
 * A link shown only on keyboard focus that jumps past a run of controls: the page's own, first on
 * every page, skips to `#main` (#103); a trend chart's skips its event markers (#168). Before
 * hydration it is a plain fragment link that scrolls to `targetId`; once hydrated it also moves
 * focus there. The fragment navigation still runs, so the address ends in `#<targetId>` either way.
 * A skip to `#main` that lands after this link has hydrated but before the page's `main` has adds
 * attributes React then reports in development as a hydration mismatch; React logs it and does not
 * patch it up, so the blur listener still clears them, and `suppressHydrationWarning` on every
 * `main` was judged worse.
 */
export function SkipLink({
  targetId,
  placement,
  children,
}: {
  targetId: string;
  /** Where the focused link sits inside its nearest positioned ancestor, as Tailwind `focus:` classes. */
  placement: string;
  children: string;
}) {
  return (
    <a
      href={`#${targetId}`}
      onClick={() => {
        const target = document.getElementById(targetId);
        if (target !== null) focusSkipTarget(target);
      }}
      className={`sr-only focus:not-sr-only focus:absolute focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background ${placement}`}
    >
      {children}
    </a>
  );
}
