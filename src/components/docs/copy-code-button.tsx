"use client";

import { useEffect, useState } from "react";

import { buttonClass } from "@/components/ui/button";
import { OutcomeAnnouncement, type Outcome } from "@/components/ui/live-region";

// Long enough to read. Each copy clears the message first, so copying again restarts the wait.
const STATUS_CLEAR_MS = 4000;

/**
 * The copy control on a docs code block. The only client code on a docs page: the block itself
 * stays server-rendered and passes its text in. The result is shown beside the button and
 * announced through live regions that are always in the DOM: polite for the copy, assertive when
 * it failed. `blockName` tells the buttons on one page apart for a screen reader ("block 3",
 * "bash, block 3") while the visible text stays "Copy code".
 */
export function CopyCodeButton({ code, blockName }: { code: string; blockName: string }) {
  const [status, setStatus] = useState<Outcome | null>(null);

  useEffect(() => {
    if (status === null) return;
    const timer = setTimeout(() => setStatus(null), STATUS_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    // Empty the region before the result arrives, so a repeated "Copied the code." is a new
    // insertion (announced again) and a changed status (its clear timer starts over).
    setStatus(null);
    try {
      await navigator.clipboard.writeText(code);
      setStatus({ tone: "info", message: "Copied the code." });
    } catch {
      // The clipboard needs permission and a secure context; the block stays selectable instead.
      setStatus({ tone: "error", message: "Could not copy the code. Select the text in the block and copy it yourself." });
    }
  }

  return (
    <>
      <OutcomeAnnouncement inline outcome={status} className="text-xs" />
      {/* The name starts with the visible text, so speech input users can say "Copy code". */}
      <button type="button" onClick={copy} aria-label={`Copy code: ${blockName}`} className={buttonClass("raised", "xs")}>
        Copy code
      </button>
    </>
  );
}
