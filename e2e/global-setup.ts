/*
 * Mints signed-in browser states for e2e tests against local Supabase, without GitHub (issue #23).
 *
 * The shared synthetic users are created (or have their password reset) with a random password
 * generated for this run only, then signed in through e2e/fixtures/auth.ts. The resulting cookies
 * are saved as Playwright storage states in `e2e/.auth/` (git ignored).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

import {
  authAdminClient,
  authEnv,
  E2E_USERS,
  ensureUser,
  signInCookies,
  STORAGE_STATE,
  type PlaywrightCookie,
} from "./fixtures/auth";
import { personalWorkspace } from "./fixtures/db";

function writeStorageState(file: string, cookies: PlaywrightCookie[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`, { mode: 0o600 });
}

/** Adds the viewer to the owner's personal workspace so role checks have a shared workspace. */
async function shareOwnerWorkspace(admin: SupabaseClient<Database>, ownerId: string, viewerId: string): Promise<void> {
  const workspace = await personalWorkspace(ownerId);

  const { error: memberError } = await admin
    .from("workspace_members")
    .upsert(
      { workspace_id: workspace.id, user_id: viewerId, role: "viewer" },
      { onConflict: "workspace_id,user_id", ignoreDuplicates: true },
    );
  if (memberError) throw new Error(`Adding the viewer to the owner's workspace failed (code ${memberError.code}).`);
}

export default async function globalSetup(): Promise<void> {
  const env = authEnv();
  const admin = authAdminClient(env);

  const ownerPassword = randomBytes(24).toString("base64url");
  const viewerPassword = randomBytes(24).toString("base64url");
  const ownerId = await ensureUser(admin, E2E_USERS.owner.email, E2E_USERS.owner.userName, ownerPassword);
  const viewerId = await ensureUser(admin, E2E_USERS.viewer.email, E2E_USERS.viewer.userName, viewerPassword);
  await shareOwnerWorkspace(admin, ownerId, viewerId);

  writeStorageState(STORAGE_STATE.owner, await signInCookies(env, E2E_USERS.owner.email, ownerPassword));
  writeStorageState(STORAGE_STATE.viewer, await signInCookies(env, E2E_USERS.viewer.email, viewerPassword));
  // A separate session for tests that sign out: signing out revokes only that session, so the
  // shared owner state stays valid for tests running in parallel.
  writeStorageState(STORAGE_STATE.ownerSignOut, await signInCookies(env, E2E_USERS.owner.email, ownerPassword));
}
