"use client";

import { createContext, use, useActionState, useState, type ReactNode } from "react";

import { acknowledgeAlert, type AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import { GuardedButton } from "@/components/guarded-button";

import { failureOf, smallButtonClass } from "./form-controls";

/**
 * Acknowledging re-renders the list, and the row's button goes away (or the whole row, while
 * acknowledged alerts are hidden). So the success message lives in one polite live region owned by
 * the list, outside every row, and focus moves to the list heading rather than being dropped.
 */

const AnnounceContext = createContext<((message: string) => void) | null>(null);

/** Wraps the triggered alerts list: provides the announcer and renders its live region. */
export function AcknowledgeAnnouncer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  return (
    <AnnounceContext value={setMessage}>
      <div role="status" aria-live="polite" className="text-sm">
        {message === "" ? null : <p className="border-b border-line px-6 py-3 text-success">{message}</p>}
      </div>
      {children}
    </AnnounceContext>
  );
}

export function AcknowledgeButton({
  workspaceSlug,
  alertId,
  accessibleSuffix,
  successMessage,
  afterAcknowledgeFocusId,
}: {
  workspaceSlug: string;
  alertId: string;
  /** Visually hidden text that makes the button name unique in the list: the alert message. */
  accessibleSuffix: string;
  successMessage: string;
  /** The list heading, which takes focus once the button is gone. */
  afterAcknowledgeFocusId: string;
}) {
  const announce = use(AnnounceContext);
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await acknowledgeAlert(previous, formData);
      if (result.ok) {
        announce?.(successMessage);
        document.getElementById(afterAcknowledgeFocusId)?.focus();
      }
      return result;
    },
    null,
  );
  if (announce === null) throw new Error("AcknowledgeButton must be rendered inside AcknowledgeAnnouncer");
  const failure = failureOf(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="alertId" value={alertId} />
      <GuardedButton type="submit" unavailable={pending} className={smallButtonClass}>
        {pending ? "Acknowledging" : "Acknowledge"}
        <span className="sr-only">: {accessibleSuffix}</span>
      </GuardedButton>
      <div role="alert" aria-live="assertive" className="text-sm">
        {failure === null ? null : (
          <p className="mt-2 text-danger">
            {failure.message}
            {failure.referenceId === undefined ? null : ` Reference ${failure.referenceId}.`}
          </p>
        )}
      </div>
    </form>
  );
}
