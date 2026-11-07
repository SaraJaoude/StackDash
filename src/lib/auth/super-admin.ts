import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { requireUser, type SessionUser } from "@/lib/auth/session";
import { superAdminEmails } from "@/lib/env";
import { log } from "@/lib/log/logger";

/*
 * Super admins (#250) run the instance: they see its configuration and instance-wide figures. They
 * are named by email in DEVMACRO_SUPER_ADMIN_EMAILS, matched against the verified email claim, the
 * same key the invite list uses. This is the one check every super admin surface calls; there is no
 * database role, so a super admin is no more than a workspace member anywhere else in the app.
 */

/** True when `email` is on the super admin list. A user with no email is never one. */
export function isSuperAdminEmail(email: string | null, admins: ReadonlySet<string> = superAdminEmails()): boolean {
  return email !== null && admins.has(email.toLowerCase());
}

/**
 * The signed-in super admin. Signed out, a redirect to sign-in like every app page; signed in as
 * anyone else, the same 404 as a page that does not exist, so the route reveals nothing. Cached per
 * request, so the page and its metadata share one check and one log line.
 */
export const requireSuperAdmin = cache(async (nextPath: string): Promise<SessionUser> => {
  const user = await requireUser(nextPath);
  if (!isSuperAdminEmail(user.email)) {
    log.warn("admin.access_refused", { userId: user.id });
    notFound();
  }
  return user;
});
