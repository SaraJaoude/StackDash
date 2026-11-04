import "server-only";

import { buildUserAuthorizeUrl, readCallback } from "@/lib/adapters/github";
import type { OAuthClient } from "@/lib/adapters/types";

import { createOAuthState, createPkcePair, newStateToken, type ConnectErrorCode, type ConsumedState } from "./oauth-state";

/*
 * GitHub's provider-specific step (#40, docs/providers/github.md). Connecting GitHub takes two
 * browser legs on the same callback route: the app install returns an untrusted `installation_id`,
 * then a user authorization (PKCE) returns the `code`. Every other provider returns the code on
 * the first leg, so this is the only branch on provider id in the connect flow.
 */

export type CallbackStep =
  // Send the browser on to another provider page (GitHub's second leg).
  | { kind: "redirect"; url: URL }
  // Exchange this code with these parameters.
  | { kind: "exchange"; code: string; callbackParams: Readonly<Record<string, string>> }
  | { kind: "error"; code: ConnectErrorCode };

export type GitHubStepInput = Readonly<{
  params: Readonly<Record<string, string>>;
  consumed: ConsumedState;
  client: OAuthClient;
  redirectUri: string;
  now: Date;
}>;

export async function githubCallbackStep({
  params,
  consumed,
  client,
  redirectUri,
  now,
}: GitHubStepInput): Promise<CallbackStep> {
  const callback = readCallback(params);
  switch (callback.step) {
    case "denied":
      return { kind: "error", code: "cancelled" };
    case "requested":
      return { kind: "error", code: "approval_pending" };
    case "installed": {
      // Leg 1 done. A new single-use state remembers the pending installation for leg 2, where the
      // adapter checks that the authorizing user can access it before trusting it.
      const state = newStateToken();
      const pkce = createPkcePair();
      await createOAuthState({
        state,
        workspaceId: consumed.workspaceId,
        provider: "github",
        userId: consumed.userId,
        codeVerifier: pkce.verifier,
        ...(consumed.reconnectId === undefined ? {} : { reconnectId: consumed.reconnectId }),
        pendingInstallationId: callback.installationId,
        now,
      });
      return {
        kind: "redirect",
        url: buildUserAuthorizeUrl({ client, state, redirectUri, codeChallenge: pkce.challenge }),
      };
    }
    case "authorized": {
      // Only a state minted in leg 1 carries an installation; a code on any other state is refused.
      if (consumed.pendingInstallationId === undefined) return { kind: "error", code: "invalid" };
      return {
        kind: "exchange",
        code: callback.code,
        // The remembered id wins over anything in the query string.
        callbackParams: { ...params, installation_id: consumed.pendingInstallationId },
      };
    }
  }
}
