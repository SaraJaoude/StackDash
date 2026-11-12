"use client";

import { useActionState } from "react";

import { addSuggestedAlerts, type AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import { GuardedButton } from "@/components/guarded-button";
import { buttonClass } from "@/components/ui/button";
import { FailureAnnouncement } from "@/components/ui/live-region";
import type { ProviderId } from "@/lib/alerts/rule-schema";

import { failureOf } from "./form-controls";

/** Adds one provider's suggested rules. Nothing is created until this button is pressed. */
export function AddSuggestedAlerts({
  workspaceSlug,
  provider,
  providerLabel,
  afterAddFocusId,
}: {
  workspaceSlug: string;
  provider: ProviderId;
  providerLabel: string;
  /** The panel disappears once its rules exist, so focus moves here (the rules heading). */
  afterAddFocusId: string;
}) {
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await addSuggestedAlerts(previous, formData);
      if (result.ok) document.getElementById(afterAddFocusId)?.focus();
      return result;
    },
    null,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="provider" value={provider} />
      <GuardedButton type="submit" unavailable={pending} className={buttonClass("raised")}>
        {pending ? "Adding" : "Add these alerts"}
        <span className="sr-only"> for {providerLabel}</span>
      </GuardedButton>
      <FailureAnnouncement failure={failureOf(state)} className="mt-2 text-sm" />
    </form>
  );
}
