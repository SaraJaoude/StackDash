/*
 * Mints signed-in browser states for e2e tests against local Supabase, without GitHub (issue #23).
 *
 * Synthetic users are created through the Auth admin API with the service role key from
 * `.env.local`, each with a random password generated for this run only and never written to disk.
 * Each user then signs in with that password through the same @supabase/ssr cookie format the app
 * reads, and the resulting cookies are saved as Playwright storage states in `e2e/.auth/`
 * (git ignored).
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../src/lib/supabase/database.types";

import { E2E_USERS, STORAGE_STATE } from "./fixtures/auth";

type Admin = SupabaseClient<Database>;

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

function toSameSite(value: CookieOptions["sameSite"]): PlaywrightCookie["sameSite"] {
  if (value === "strict" || value === true) return "Strict";
  if (value === "none") return "None";
  return "Lax";
}

/** Finds a user by email. Local e2e databases hold a handful of users, so one page is enough. */
async function findUserId(admin: Admin, email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Listing users failed: ${error.message}`);
  return data.users.find((user) => user.email === email)?.id ?? null;
}

/** Creates the user or resets the password of the existing one. Returns the user id. */
async function ensureUser(admin: Admin, email: string, userName: string, password: string): Promise<string> {
  // The invite comes first: the before-user-created hook refuses emails that are not invited.
  const { error: inviteError } = await admin
    .from("access_invites")
    .upsert({ email, invited_by: "e2e global setup" }, { onConflict: "email", ignoreDuplicates: true });
  if (inviteError) throw new Error(`Inviting ${email} failed (code ${inviteError.code}).`);

  const existingId = await findUserId(admin, email);
  if (existingId !== null) {
    const { error } = await admin.auth.admin.updateUserById(existingId, { password, email_confirm: true });
    if (error) throw new Error(`Resetting the password of ${email} failed: ${error.message}`);
    return existingId;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { user_name: userName },
  });
  if (error) throw new Error(`Creating ${email} failed: ${error.message}`);
  return data.user.id;
}

/** Signs in with a password and returns the auth cookies the app would have set. */
async function signInCookies(
  env: z.infer<typeof envSchema>,
  email: string,
  password: string,
): Promise<PlaywrightCookie[]> {
  const jar = new Map<string, { value: string; options: CookieOptions }>();
  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return [...jar].map(([name, { value }]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          // An empty value is a deletion (for example a stale chunk); drop it from the jar.
          if (value === "") jar.delete(name);
          else jar.set(name, { value, options });
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Signing in ${email} failed: ${error.message}`);
  if (jar.size === 0) throw new Error(`Signing in ${email} set no cookies.`);

  const nowSeconds = Math.floor(Date.now() / 1000);
  return [...jar].map(([name, { value, options }]) => ({
    name,
    value,
    // Playwright's baseURL is http://localhost:<port>, so the cookies belong to that host.
    domain: "localhost",
    path: "/",
    expires: options.maxAge === undefined ? -1 : nowSeconds + options.maxAge,
    httpOnly: options.httpOnly ?? false,
    secure: false,
    sameSite: toSameSite(options.sameSite),
  }));
}

function writeStorageState(file: string, cookies: PlaywrightCookie[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`, { mode: 0o600 });
}

/** Adds the viewer to the owner's personal workspace so role checks have a shared workspace. */
async function shareOwnerWorkspace(admin: Admin, ownerId: string, viewerId: string): Promise<void> {
  const { data: workspace, error } = await admin
    .from("workspaces")
    .select("id")
    .eq("created_by", ownerId)
    .eq("is_personal", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Finding the owner's workspace failed (code ${error.code}).`);
  if (workspace === null) throw new Error("The e2e owner has no personal workspace.");

  const { error: memberError } = await admin
    .from("workspace_members")
    .upsert(
      { workspace_id: workspace.id, user_id: viewerId, role: "viewer" },
      { onConflict: "workspace_id,user_id", ignoreDuplicates: true },
    );
  if (memberError) throw new Error(`Adding the viewer to the owner's workspace failed (code ${memberError.code}).`);
}

export default async function globalSetup(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const parsedEnv = envSchema.safeParse(process.env);
  if (!parsedEnv.success) {
    throw new Error(
      "e2e auth setup needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local. Run `supabase start`, then copy them from `supabase status -o env`.",
    );
  }
  const env = parsedEnv.data;
  const admin = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
