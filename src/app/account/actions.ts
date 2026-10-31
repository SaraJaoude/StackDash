"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { accountDeletedPath, blockedMessage, confirmationMatches } from "@/lib/account/delete-account";
import { requireUser } from "@/lib/auth/session";
import { deleteUserAccount, loadAccountIdentity } from "@/lib/data/account";
import { log, logError } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";

export type DeleteAccountResult = {
  ok: false;
  fieldErrors?: Record<string, string>;
  message: string;
  referenceId?: string;
};

const deleteAccountSchema = z.object({ confirmation: z.string().max(320) }).strict();

const CONFIRMATION_ERROR = "Type your email address or GitHub username exactly as shown.";

/**
 * Ends the session after the account is gone. `signOut` treats an already deleted user as signed
 * out and clears the cookies; if it reports anything else, the auth cookies are dropped here so the
 * browser never keeps tokens for a deleted account.
 */
async function endSession(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error === null) return;
  log.warn("account.sign_out_after_delete_failed", { status: error.status ?? null });
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith("sb-")) store.delete(name);
  }
}

/**
 * Deletes the signed-in user's account (#42). The user comes from the session and the plan is
 * rebuilt on the server; the form only carries the typed confirmation.
 */
export async function deleteAccount(
  _previous: DeleteAccountResult | null,
  formData: FormData,
): Promise<DeleteAccountResult> {
  const parsed = deleteAccountSchema.safeParse({ confirmation: formData.get("confirmation") });
  if (!parsed.success) return { ok: false, message: "This form is out of date. Reload the page and try again." };

  let destination: string;
  try {
    const user = await requireUser("/account");
    const identity = await loadAccountIdentity(user.id);
    if (!confirmationMatches(parsed.data.confirmation, identity)) {
      return {
        ok: false,
        fieldErrors: { confirmation: CONFIRMATION_ERROR },
        message: `Your account was not deleted. ${CONFIRMATION_ERROR}`,
      };
    }
    const result = await deleteUserAccount(user.id);
    if (!result.ok) {
      return { ok: false, message: `Your account was not deleted. ${blockedMessage(result.blocked.map(({ name }) => name))}` };
    }
    destination = accountDeletedPath(result.outcome);
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message:
        "Your account could not be deleted. Some connections may now be disconnected. Try again in a moment.",
      referenceId: logError("account.delete_failed", error),
    };
  }
  await endSession();
  redirect(destination);
}
