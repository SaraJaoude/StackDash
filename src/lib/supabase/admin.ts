import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnv, serverEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Service role client for trusted server work with no user session, such as background polling.
 * It bypasses row level security, so every query must scope rows to a workspace explicitly.
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = publicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    // No user session exists here, so there is nothing to store or refresh.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
