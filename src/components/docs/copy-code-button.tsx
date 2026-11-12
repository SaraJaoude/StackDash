"use client";

import { useEffect, useState } from "react";

import { buttonClass } from "@/components/ui/button";

// Long enough to read. Each copy clears the message first, so copying again restarts the wait.
const STATUS_CLEAR_MS = 4000;

/**
 * The copy control on a docs code block. The only client code on a docs page: the block itself
 * stays server-rendered and passes its text in. The result is shown beside the button and
 * announced through a polite live region that is always in the DOM, so a screen reader hears it.
 * `blockName` tells the buttons on one page apart for a screen reader ("block 3", "bash, block 3")
 * while the visible text stays "Copy code".
 */
export function CopyCodeButton({ code, blockName }: { code: string; blockName: string }) {
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (status === "") return;
    const timer = setTimeout(() => setStatus(""), STATUS_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    // Empty the region before the result arrives, so a repeated "Copied the code." is a new
    // insertion (announced again) and a changed status (its clear timer starts over).
    setStatus("");
    try {
      await navigator.clipboard.writeText(code);
      setStatus("Copied the code.");
    } catch {
      // The clipboard needs permission and a secure context; the block stays selectable instead.
      setStatus("Could not copy the code. Select the text in the block and copy it yourself.");
    }
  }

  return (
    <>
      <span role="status" aria-live="polite" className="text-xs text-muted">
        {status}
      </span>
      {/* The name starts with the visible text, so speech input users can say "Copy code". */}
      <button type="button" onClick={copy} aria-label={`Copy code: ${blockName}`} className={buttonClass("raised", "xs")}>
        Copy code
      </button>
    </>
  );
}
