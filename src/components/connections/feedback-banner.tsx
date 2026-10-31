"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A message the page shows after a redirect (a failed connect, a deletion). Errors take focus on
 * arrival so keyboard and screen reader users land on what went wrong, as an error summary should.
 */
export function FeedbackBanner({
  tone,
  title,
  children,
}: {
  tone: "error" | "success";
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (tone === "error") ref.current?.focus();
  }, [tone]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      aria-labelledby={titleId}
      className={`mt-6 rounded-xl border bg-panel px-5 py-4 text-sm outline-offset-2 ${
        tone === "error" ? "border-danger/50" : "border-success/40"
      }`}
    >
      <p id={titleId} className={`font-semibold ${tone === "error" ? "text-danger" : "text-success"}`}>
        {title}
      </p>
      <div className="mt-1 leading-6 text-muted">{children}</div>
    </div>
  );
}
