"use client";

import { useEffect, useRef } from "react";

/** The failed result of a confirmed action: one sentence for the user, and a reference when it was unexpected. */
export type DialogFailure = Readonly<{ message: string; referenceId?: string | undefined }>;

/**
 * The error of a failed confirmation, rendered inside its modal `<dialog>` (#323). While a modal
 * dialog is open everything outside it is inert, so a status region beside the opener is neither
 * seen nor announced. Render this inside the dialog's content, which stays mounted while the
 * dialog is open: the region is always there, so inserting a message announces it (assertive,
 * because the action did not happen), and focus moves to the message so keyboard users land on
 * what went wrong. Every attempt returns a new result object, so a repeated failure moves focus
 * again, and the move announces it even when the text is unchanged.
 */
export function DialogError({ failure }: { failure: DialogFailure | null | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const shown = failure ?? null;
  useEffect(() => {
    if (shown !== null) ref.current?.focus();
  }, [shown]);

  return (
    <div role="alert" aria-live="assertive" className="text-sm">
      {shown === null ? null : (
        <p
          ref={ref}
          tabIndex={-1}
          className="mt-4 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 leading-6 text-danger"
        >
          {shown.message}
          {shown.referenceId === undefined ? null : (
            <>
              {" "}
              Reference <code className="font-mono text-xs text-foreground">{shown.referenceId}</code>.
            </>
          )}
        </p>
      )}
    </div>
  );
}
