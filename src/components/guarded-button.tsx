"use client";

import type { ComponentProps } from "react";

type GuardedButtonProps = Omit<ComponentProps<"button">, "aria-disabled"> & {
  /** True while the button must not act: its form action is pending, or a cooldown runs. */
  unavailable: boolean;
};

/**
 * Cancels the click of an unavailable button, or passes it on. Every way of pressing a button
 * reaches its click: a pointer, Enter, Space, and implicit submission from a field (the HTML
 * spec fires a click at the form's default button), so cancelling it blocks all of them.
 */
export function guardClick<E extends { preventDefault(): void }>(
  unavailable: boolean,
  event: E,
  onClick: ((event: E) => void) | undefined,
): void {
  if (unavailable) {
    event.preventDefault();
    return;
  }
  onClick?.(event);
}

/**
 * A button that keeps keyboard focus while it is unavailable (#161). The native `disabled`
 * attribute cannot hold focus: pressing Enter on a submit button that disables itself while its
 * action runs drops focus to `<body>`. This marks itself `aria-disabled` instead, which assistive
 * tech announces as unavailable, and `guardClick` blocks the duplicate submit. Style the state with
 * the `aria-disabled:` variant.
 */
export function GuardedButton({ unavailable, onClick, ...props }: GuardedButtonProps) {
  return (
    <button {...props} aria-disabled={unavailable || undefined} onClick={(event) => guardClick(unavailable, event, onClick)} />
  );
}
