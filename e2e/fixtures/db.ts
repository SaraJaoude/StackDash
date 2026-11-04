/*
 * Service-role access to local Supabase for e2e specs that need synthetic data.
 *
 * Isolation rule: a spec that seeds data creates its own workspace with `createTestWorkspace` and
 * only touches rows inside it, so specs can run in parallel and in any order. Never seed into the
 * owner's personal workspace, which other specs read.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../src/lib/supabase/database.types";

import { E2E_USERS } from "./auth";

export type Admin = SupabaseClient<Database>;

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

let cached: Admin | undefined;

export function adminClient(): Admin {
  if (cached !== undefined) return cached;
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env = envSchema.parse(process.env);
  cached = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

async function userIdByEmail(admin: Admin, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Listing users failed: ${error.message}`);
  const user = data.users.find((candidate) => candidate.email === email);
  if (user === undefined) throw new Error(`No e2e user ${email}; global setup creates it.`);
  return user.id;
}

export type TestWorkspace = Readonly<{ id: string; slug: string; name: string; ownerId: string; viewerId: string }>;

/**
 * A fresh workspace owned by the e2e owner, with the e2e viewer as a viewer member. The name is
 * unique per call so specs never collide.
 */
export async function createTestWorkspace(label: string): Promise<TestWorkspace> {
  const admin = adminClient();
  const [ownerId, viewerId] = await Promise.all([
    userIdByEmail(admin, E2E_USERS.owner.email),
    userIdByEmail(admin, E2E_USERS.viewer.email),
  ]);
  const name = `${label} ${randomUUID().slice(0, 8)}`;
  const { data, error } = await admin.rpc("create_workspace", {
    p_user_id: ownerId,
    p_name: name,
    p_is_personal: false,
  });
  if (error) throw new Error(`Creating a test workspace failed (code ${error.code}).`);
  const workspace = z.object({ id: z.string(), slug: z.string() }).parse(data);
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: viewerId, role: "viewer" });
  if (memberError) throw new Error(`Adding the viewer failed (code ${memberError.code}).`);
  return { id: workspace.id, slug: workspace.slug, name, ownerId, viewerId };
}

/** Deletes a test workspace and, by cascade, everything seeded into it. */
export async function deleteTestWorkspace(workspace: TestWorkspace): Promise<void> {
  const { error } = await adminClient().from("workspaces").delete().eq("id", workspace.id);
  if (error) throw new Error(`Deleting test workspace failed (code ${error.code}).`);
}
