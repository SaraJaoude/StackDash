import { notFound } from "next/navigation";
import { connection } from "next/server";

// Any /app path with no page of its own. The proxy enforces the nonce CSP on /app paths
// (src/proxy.ts), and Next.js would answer them with the not-found page prerendered at build time,
// whose scripts carry no nonce and would be blocked. Rendering per request here lets the not-found
// page carry the nonce (#197); awaiting `connection()` before `notFound()` keeps the 404 status
// ahead of the first byte.
export const instant = false;

export default async function MissingAppPage(): Promise<never> {
  await connection();
  notFound();
}
