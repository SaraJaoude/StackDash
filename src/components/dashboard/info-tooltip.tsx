"use client";

import { useEffect, useId, useState } from "react";

/**
 * A small "how is this worked out" button with a tooltip. The text is the button's accessible
 * description, so a screen reader announces it on focus whether or not it is shown. It opens on
 * hover, focus, or a tap, stays open while the pointer is over it, and closes on Escape wherever
 * focus is, so a tooltip opened by hover can be dismissed without moving the pointer (WCAG
 * 1.4.13, content on hover or focus).
 */
export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="inline-flex size-6 items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:text-foreground"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4" strokeLinecap="round" />
          <circle cx="8" cy="4.75" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        hidden={!open}
        className="absolute top-full left-0 z-10 mt-2 w-72 max-w-[80vw] rounded-md border border-line bg-panel-raised p-3 text-xs leading-5 font-normal text-foreground shadow-lg"
      >
        {text}
      </span>
    </span>
  );
}
