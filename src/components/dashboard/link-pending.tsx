"use client";

import { useLinkStatus } from "next/link";

/**
 * A `Link`'s text, which names what is loading while its navigation is pending (#263), per
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md. Only the
 * words change, in place, so nothing else on the page moves.
 */
export function LinkPendingLabel({ idle, pending }: { idle: string; pending: string }) {
  return useLinkStatus().pending ? pending : idle;
}
