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
 * Moves keyboard focus onto the skip link's target, so the next Tab continues inside the content
 * rather than back at the page navigation (#103). A landmark only takes focus with a tabindex, and
 * a permanent one would let every click inside it focus it, which restarts Tab at its first
 * control. So the tabindex is added for the skip and removed when focus leaves, as GOV.UK Frontend's
 * skip link does (`setFocus` in `govuk/common/index.mjs`).
 */
export function focusSkipTarget(target: SkipTarget): void {
  if (target.getAttribute("tabindex") === null) {
    target.setAttribute("tabindex", "-1");
    target.addEventListener(
      "focus",
      () => target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true }),
      { once: true },
    );
  }
  target.focus();
}

/**
 * The first control on every page. Before hydration it is a plain fragment link that scrolls to
 * `#main`; once hydrated it also moves focus there. The fragment navigation still runs, so the
 * address ends in `#main` either way.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={() => {
        const target = document.getElementById("main");
        if (target !== null) focusSkipTarget(target);
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
    >
      Skip to content
    </a>
  );
}
