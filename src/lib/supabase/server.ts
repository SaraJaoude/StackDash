import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * User-scoped Supabase client for Server Components, Server Functions, and Route Handlers.
 * Queries run as the signed-in user, so row level security applies.
 *
 * Create one per request: the client holds that request's session and cookie writer.
 */
export async function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = publicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // The cache-control headers passed as the second argument cannot be set through
        // `cookies()`; the proxy, which refreshes sessions on every request, sets them instead.
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch (error) {
            // Server Components cannot write cookies. The proxy has already refreshed the
            // session for this request, so a refresh attempted during rendering is safe to drop.
            // Next.js does not export its read-only cookies error class, so it is recognized by
            // message. Anything else is a real failure.
            if (
              error instanceof Error &&
              error.message.startsWith("Cookies can only be modified in")
            ) {
              return;
            }
            throw new Error("Failed to write Supabase auth cookies", { cause: error });
          }
        },
      },
    },
  );
}
