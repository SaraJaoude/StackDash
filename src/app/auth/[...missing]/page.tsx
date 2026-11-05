import { notFound } from "next/navigation";
import { connection } from "next/server";

// Any /auth path with no page or route handler of its own. The proxy enforces the nonce CSP on
// /auth paths (src/proxy.ts), and Next.js would answer them with the not-found page prerendered at
// build time, whose scripts carry no nonce and would be blocked. Rendering per request here lets
// the not-found page carry the nonce (#197); awaiting `connection()` before `notFound()` keeps the
// 404 status ahead of the first byte.
export const instant = false;

export default async function MissingAuthPage(): Promise<never> {
  await connection();
  notFound();
}
