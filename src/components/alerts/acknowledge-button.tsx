"use client";

import { createContext, use, useActionState, useState, type ReactNode } from "react";

import {
  acknowledgeAlert,
  acknowledgeAllAlerts,
  type AcknowledgeAllResult,
  type AlertActionResult,
} from "@/app/w/[workspace]/alerts/actions";
import { GuardedButton } from "@/components/guarded-button";
import { buttonClass } from "@/components/ui/button";

import { failureOf } from "./form-controls";
import { acknowledgedAllMessage } from "./labels";

/**
 * Acknowledging re-renders the list, and the row's button goes away (or the whole row, while
 * acknowledged alerts are hidden). So the success message lives in one polite live region owned by
 * the list, outside every row, and focus moves to the list heading rather than being dropped.
 * "Acknowledge all" (#268) announces through the same region.
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
      <GuardedButton type="submit" unavailable={pending} className={buttonClass("raised", "xs")}>
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

/**
 * Acknowledges every unacknowledged alert in the workspace (up to the action's per-call limit).
 * Once none are left the button goes away, so focus moves to the list heading; while some remain
 * it stays on the button, ready to press again.
 */
export function AcknowledgeAllButton({
  workspaceSlug,
  showAcknowledged,
  afterAcknowledgeFocusId,
}: {
  workspaceSlug: string;
  showAcknowledged: boolean;
  afterAcknowledgeFocusId: string;
}) {
  const announce = use(AnnounceContext);
  const [state, formAction, pending] = useActionState<AcknowledgeAllResult | null, FormData>(
    async (previous, formData) => {
      const result = await acknowledgeAllAlerts(previous, formData);
      if (result.ok) {
        announce?.(acknowledgedAllMessage(result, showAcknowledged));
        if (result.remaining === 0) document.getElementById(afterAcknowledgeFocusId)?.focus();
      }
      return result;
    },
    null,
  );
  if (announce === null) throw new Error("AcknowledgeAllButton must be rendered inside AcknowledgeAnnouncer");
  const failure = failureOf(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <GuardedButton type="submit" unavailable={pending} className={buttonClass("raised", "xs")}>
        {pending ? "Acknowledging all" : "Acknowledge all"}
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
