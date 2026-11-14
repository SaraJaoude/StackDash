"use client";

import { useState, type ReactNode } from "react";

/**
 * A Pause control for a picture that moves in CSS alone, such as the phone data-flow picture.
 * Pausing sets data-paused, and globals.css holds every animation inside in place, so they all
 * resume in step. Hidden under reduced motion, where nothing inside moves.
 */
export function PausableMotion({ className = "", children }: { className?: string; children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <div data-paused={paused || undefined} className={`motion-host ${className}`.trim()}>
      {children}
      <div className="mt-2 flex justify-end motion-reduce:hidden">
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className="min-h-7 rounded-md border border-line px-2.5 font-mono text-xs text-muted transition-colors hover:border-line-strong hover:text-foreground"
        >
          {paused ? "Resume" : "Pause"}
          <span className="sr-only"> animation</span>
        </button>
      </div>
    </div>
  );
}
