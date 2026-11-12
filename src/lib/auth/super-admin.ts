import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { requireUser, type SessionUser } from "@/lib/auth/session";
import { superAdminEmails } from "@/lib/env";
import { log, logError } from "@/lib/log/logger";

/*
 * Super admins (#250) run the instance: they see its configuration and instance-wide figures. They
 * are named by email in DEVMACRO_SUPER_ADMIN_EMAILS, matched against the verified email claim, the
 * same key the invite list uses. This is the one check every super admin surface calls; there is no
 * database role, so a super admin is no more than a workspace member anywhere else in the app.
 */

/** The super admin page: the instance overview. */
export const ADMIN_PATH = "/app/admin";

/** True when `email` is on the super admin list. A user with no email is never one. */
export function isSuperAdminEmail(email: string | null, admins: ReadonlySet<string> = superAdminEmails()): boolean {
  return email !== null && admins.has(email.toLowerCase());
}

/**
 * Whether the app header and the command palette offer the way to the admin page (#364): the rule
 * `requireSuperAdmin` applies, for a user the caller already verified, so only a super admin's HTML
 * and RSC payload carry the link or `ADMIN_PATH`. An invalid list hides the link and logs why,
 * rather than failing every page that shows the header; the admin page itself still fails on it.
 * Cached per request, so the header and the palette share one check and one log line.
 */
export const showsAdminLink = cache((email: string | null): boolean => {
  try {
    return isSuperAdminEmail(email);
  } catch (error) {
    logError("admin.link_check_failed", error);
    return false;
  }
});

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
