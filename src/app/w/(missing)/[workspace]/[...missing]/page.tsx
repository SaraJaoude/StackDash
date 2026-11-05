import { notFound } from "next/navigation";
import { connection } from "next/server";

// Any path inside a workspace with no page of its own. The proxy enforces the nonce CSP on /w paths
// (src/proxy.ts), and Next.js would answer them with the not-found page prerendered at build time,
// whose scripts carry no nonce and would be blocked. Rendering per request here lets the not-found
// page carry the nonce (#197); awaiting `connection()` before `notFound()` keeps the 404 status
// ahead of the first byte.
//
// The `(missing)` route group keeps this segment out of the workspace layout: its loading boundary
// streams the shell before any page under it renders, so a notFound() there answers 200. The
// response is the same for every slug, so it never confirms which workspace addresses are real.
export const instant = false;

export default async function MissingWorkspacePage(): Promise<never> {
  await connection();
  notFound();
}
