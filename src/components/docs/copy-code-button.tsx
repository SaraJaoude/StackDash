"use client";

import { useEffect, useState } from "react";

// Long enough to read, short enough that copying the same block again is announced again.
const STATUS_CLEAR_MS = 4000;

// The look of `smallButtonClass` (alerts form controls), at least 32 by 32 pixels. Not imported from
// there: that module would pull the alert form code into every docs page's client bundle.
const BUTTON_CLASS =
  "inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-line-strong bg-panel-raised px-3 py-1 text-sm font-medium text-foreground transition-colors hover:border-accent";

/**
 * The copy control on a docs code block. The only client code on a docs page: the block itself
 * stays server-rendered and passes its text in. The result is shown beside the button and
 * announced through a polite live region that is always in the DOM, so a screen reader hears it.
 */
export function CopyCodeButton({ code }: { code: string }) {
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (status === "") return;
    const timer = setTimeout(() => setStatus(""), STATUS_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
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
      <button type="button" onClick={copy} className={BUTTON_CLASS}>
        Copy code
      </button>
    </>
  );
}
