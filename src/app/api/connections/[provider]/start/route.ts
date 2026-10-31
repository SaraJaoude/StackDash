import { notFound, unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { getAdapter, isFakeProviderEnabled, loadOAuthClient } from "@/lib/adapters/registry";
import { ProviderIdSchema } from "@/lib/adapters/types";
import { requireUser } from "@/lib/auth/session";
import {
  callbackRedirectUri,
  connectFeedbackQuery,
  connectOrigin,
  createOAuthState,
  createPkcePair,
  newStateToken,
  type ConnectFeedback,
} from "@/lib/connections/oauth-state";
import { getConnection, isConnectionId } from "@/lib/data/connections";
import { logError } from "@/lib/log/logger";
import {
  isWorkspaceSlug,
  requireWorkspaceAction,
  workspacePath,
  type WorkspaceAccess,
} from "@/lib/workspaces/access";
import { ForbiddenError } from "@/lib/workspaces/permissions";

/**
 * Starts connecting a provider (#40): `GET ?workspace=<slug>&consent=1[&connection=<id>]`, sent by
 * the permission disclosure form. Authorizes the member, checks consent for full-access
 * permissions, stores a single-use state (with the PKCE verifier sealed), and redirects to the
 * provider's consent screen.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/connections/[provider]/start">) {
  const { provider: providerParam } = await ctx.params;
  const parsedProvider = ProviderIdSchema.safeParse(providerParam);
  if (!parsedProvider.success) notFound();
  const provider = parsedProvider.data;
  if (provider === "fake" && !isFakeProviderEnabled()) notFound();

  const query = request.nextUrl.searchParams;
  const slug = query.get("workspace") ?? "";
  if (!isWorkspaceSlug(slug)) notFound();
  const reconnectParam = query.get("connection");
  const connectionsPath = workspacePath(slug, "connections");
  const disclosurePath = `${connectionsPath}/new/${provider}`;

  const back = (path: string, feedback: ConnectFeedback, extra?: Record<string, string>) => {
    const url = new URL(`${path}?${connectFeedbackQuery(feedback)}`, request.nextUrl.origin);
    for (const [key, value] of Object.entries(extra ?? {})) url.searchParams.set(key, value);
    return NextResponse.redirect(url, 303);
  };

  await requireUser(disclosurePath);
  let access: WorkspaceAccess;
  try {
    access = await requireWorkspaceAction(slug, "manage_connections");
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) return back(connectionsPath, { error: "forbidden", provider });
    const ref = logError("connections.start_authorize_failed", error, { provider });
    return back(connectionsPath, { error: "failed", provider, ref });
  }

  const adapter = getAdapter(provider);
  const client = loadOAuthClient(adapter);
  if (client === null) return back(connectionsPath, { error: "not_configured", provider });

  const reconnectExtra: Record<string, string> =
    reconnectParam === null ? {} : { connection: reconnectParam };
  const needsConsent = adapter.permissions.some((permission) => permission.access === "full");
  if (needsConsent && query.get("consent") !== "1") {
    return back(disclosurePath, { error: "consent_required", provider }, reconnectExtra);
  }

  try {
    let reconnectId: string | undefined;
    let redirectAfter = connectionsPath;
    if (reconnectParam !== null) {
      // Re-read in this workspace: a missing id and another tenant's id get the same answer.
      const existing = isConnectionId(reconnectParam)
        ? await getConnection(access.workspace.id, reconnectParam)
        : null;
      if (existing === null || existing.provider !== provider) {
        return back(connectionsPath, { error: "invalid", provider });
      }
      reconnectId = existing.id;
      redirectAfter = `${connectionsPath}/${existing.id}`;
    }

    const state = newStateToken();
    const pkce = adapter.oauth.pkce ? createPkcePair() : null;
    const redirectUri = callbackRedirectUri(connectOrigin(request.url, process.env.NEXT_PUBLIC_SITE_URL), provider);
    // Request data is all read above, so the clock is safe to read now.
    await createOAuthState({
      state,
      workspaceId: access.workspace.id,
      provider,
      userId: access.user.id,
      ...(pkce === null ? {} : { codeVerifier: pkce.verifier }),
      redirectAfter,
      ...(reconnectId === undefined ? {} : { reconnectId }),
      now: new Date(),
    });

    const authorizeUrl = adapter.buildAuthorizeUrl({
      client,
      state,
      redirectUri,
      ...(pkce === null ? {} : { codeChallenge: pkce.challenge }),
    });
    return NextResponse.redirect(authorizeUrl, 303);
  } catch (error) {
    unstable_rethrow(error);
    const ref = logError("connections.start_failed", error, { provider });
    return back(connectionsPath, { error: "failed", provider, ref });
  }
}
