/**
 * True when a form was posted from this site. A bare route handler gets no framework CSRF
 * protection, so every state-changing one checks this first. A cross-site form or `fetch` cannot
 * forge the `Origin` header, and a request without one is refused.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin === null || host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
