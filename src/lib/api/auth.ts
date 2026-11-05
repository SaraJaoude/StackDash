import "server-only";

import { ApiError, forbidden, unauthorized } from "@/lib/api/errors";
import { bearerApiKey, hashApiKey } from "@/lib/api/keys";
import type { ApiKeyScope } from "@/lib/api/scopes";
import { createAdminClient } from "@/lib/supabase/admin";

/** Requests one key may make per minute (fixed window). Per plan limits are #96. */
export const API_RATE_LIMIT_PER_MINUTE = 120;

/** Who is calling: one key of one workspace. Pass `tokenHash` to the API read functions. */
export type ApiPrincipal = Readonly<{
  keyId: string;
  workspaceId: string;
  scopes: readonly ApiKeyScope[];
  /** SHA-256 hex of the presented key. The read functions resolve the workspace from it again. */
  tokenHash: string;
}>;

export type ApiRateLimit = Readonly<{ limit: number; remaining: number; resetsAt: Date }>;

export type ApiAuthentication = Readonly<{ principal: ApiPrincipal; rateLimit: ApiRateLimit }>;

/** X-RateLimit-* headers for every answer to an authenticated request, allowed or refused. */
export function rateLimitHeaders(rateLimit: ApiRateLimit): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetsAt.getTime() / 1000)),
  };
}

/**
 * The one API key check. Every /api/v1 route goes through it, and the read-only MCP server (#163)
 * must reuse it rather than look keys up itself:
 *
 *   const { principal, rateLimit } = await authenticateApiRequest(request);
 *   requireApiScope(principal, "usage:read");
 *   // then call a loader from src/lib/api/resources.ts with principal.tokenHash
 *
 * It reads the bearer key, looks it up by hash with `public.authenticate_api_key` (one round
 * trip that also counts the request and refreshes last_used_at), and enforces the per key rate
 * limit. It throws an ApiError: 401 for a missing, malformed, unknown, revoked, or orphaned key
 * (one answer for all of them, the reason only in the log), and 429 past the limit. A database
 * failure is rethrown as a plain Error so it answers 500, never "your key was revoked".
 */
export async function authenticateApiRequest(request: Request): Promise<ApiAuthentication> {
  const key = bearerApiKey(request.headers.get("authorization"));
  if (key === null) {
    throw unauthorized(request.headers.has("authorization") ? "malformed" : "missing");
  }

  const tokenHash = hashApiKey(key);
  const { data, error } = await createAdminClient().rpc("authenticate_api_key", { p_token_hash: tokenHash });
  if (error) throw new Error("API key lookup failed", { cause: error });

  const row = data[0];
  if (row === undefined) throw unauthorized("unknown");
  if (row.status !== "valid") {
    throw unauthorized(row.status, { keyId: row.key_id, workspaceId: row.workspace_id });
  }

  const rateLimit: ApiRateLimit = {
    limit: API_RATE_LIMIT_PER_MINUTE,
    remaining: Math.max(0, API_RATE_LIMIT_PER_MINUTE - row.request_count),
    resetsAt: new Date(row.window_resets_at),
  };
  if (row.request_count > API_RATE_LIMIT_PER_MINUTE) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetsAt.getTime() - Date.now()) / 1000));
    throw new ApiError(
      "rate_limited",
      `This API key made more than ${API_RATE_LIMIT_PER_MINUTE} requests in one minute. Wait for the number of seconds in the Retry-After header, then try again.`,
      {
        headers: { ...rateLimitHeaders(rateLimit), "Retry-After": String(retryAfterSeconds) },
        logFields: { keyId: row.key_id, workspaceId: row.workspace_id, requestCount: row.request_count },
      },
    );
  }

  return {
    principal: { keyId: row.key_id, workspaceId: row.workspace_id, scopes: row.scopes, tokenHash },
    rateLimit,
  };
}

/** Throws a 403 ApiError unless the key holds `scope`. */
export function requireApiScope(principal: ApiPrincipal, scope: ApiKeyScope): void {
  if (!principal.scopes.includes(scope)) {
    throw forbidden(scope, { keyId: principal.keyId, workspaceId: principal.workspaceId });
  }
}
