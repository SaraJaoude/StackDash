import { notFound } from "next/navigation";

// Any path inside a workspace with no page of its own. Without this segment Next.js answers with
// the not-found page prerendered at build time, whose scripts carry no nonce and are blocked by the
// CSP the proxy enforces here (src/proxy.ts). Here the workspace layout renders per request, so
// the not-found page beside this file carries the nonce and shows inside the workspace shell
// (#197).
export default function MissingWorkspacePage(): never {
  notFound();
}
