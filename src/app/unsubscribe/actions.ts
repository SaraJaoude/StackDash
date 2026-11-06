"use server";

import { unsubscribeMember } from "@/lib/data/notification-preferences";
import { logError } from "@/lib/log/logger";
import { readUnsubscribeToken } from "@/lib/notifications/unsubscribe";

export type UnsubscribeResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "invalid_link" }>
  | Readonly<{ ok: false; reason: "failed"; referenceId: string }>;

/**
 * The button on the unsubscribe page (#152). The signed token is the whole authorization, as for
 * the one-click route: whoever holds the email can turn its alert emails off, and nothing else.
 * Safe to repeat. It answers in place rather than redirecting, so the page keeps its title and
 * focus moves to the confirmation (unsubscribe-form.tsx).
 */
export async function unsubscribeFromEmail(_previous: UnsubscribeResult | null, formData: FormData): Promise<UnsubscribeResult> {
  const token = formData.get("token");
  const target = readUnsubscribeToken(typeof token === "string" ? token : null);
  if (target === null) return { ok: false, reason: "invalid_link" };
  try {
    // "not_member" counts as done: someone who left the workspace gets no alert email from it.
    await unsubscribeMember(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", referenceId: logError("notifications.unsubscribe_failed", error, { workspaceId: target.workspaceId }) };
  }
}
