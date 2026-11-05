"use server";

import { redirect } from "next/navigation";

import { unsubscribeMember } from "@/lib/data/notification-preferences";
import { logError } from "@/lib/log/logger";
import { UNSUBSCRIBE_PAGE_PATH } from "@/lib/notifications/links";
import { readUnsubscribeToken } from "@/lib/notifications/unsubscribe";

/**
 * The button on the unsubscribe page (#152). The signed token is the whole authorization, as for
 * the one-click route: whoever holds the email can turn its alert emails off, and nothing else.
 * Answers with a redirect back to the page, which then shows the stored setting, so a reload or a
 * second click changes nothing. A token that does not verify goes back without it, so the page
 * says the link is not valid.
 */
export async function unsubscribeFromEmail(formData: FormData): Promise<void> {
  const token = formData.get("token");
  const target = readUnsubscribeToken(typeof token === "string" ? token : null);
  const query = new URLSearchParams();
  if (target !== null && typeof token === "string") {
    query.set("token", token);
    try {
      await unsubscribeMember(target);
    } catch (error) {
      query.set("ref", logError("notifications.unsubscribe_failed", error, { workspaceId: target.workspaceId }));
    }
  }
  redirect(`${UNSUBSCRIBE_PAGE_PATH}?${query.toString()}`);
}
