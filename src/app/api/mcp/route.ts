import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { unstable_rethrow } from "next/navigation";

import { authenticateApiRequest, rateLimitHeaders } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/errors";
import { connectOrigin } from "@/lib/connections/oauth-state";
import { log } from "@/lib/log/logger";
import { authInfoFor, createDevMacroMcpServer, principalFrom } from "@/lib/mcp/server";

/*
 * The read-only MCP endpoint (#163), Streamable HTTP at /api/mcp. Each request goes through the
 * REST API's key check first (authenticateApiRequest: 401 for a key that does not work, 429 past
 * the per key limit, the same error envelope as /api/v1), then the SDK's handler, which builds a
 * fresh server for that key (src/lib/mcp/server.ts). Stateless: nothing is kept between requests,
 * so it runs the same on every server and on a self-hosted install. See docs/mcp.md.
 */

// Tool calls carry a few short filters; anything near this size is not a DevMacro request.
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

const NO_STORE = { "Cache-Control": "no-store" } as const;

// The default response mode answers with one JSON body unless a tool sends progress or log
// messages first, and none does.
const handler = createMcpHandler(({ authInfo }) => createDevMacroMcpServer(principalFrom(authInfo)), {
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  onerror: (error) => log.warn("mcp.request_rejected", { message: error.message }),
});

// Every MCP message is a POST (Streamable HTTP, Sending Messages). The endpoint keeps no sessions,
// so it has no GET stream or DELETE, and Next.js answers those methods with 405.
export async function POST(request: Request): Promise<Response> {
  // Streamable HTTP, Security: a request whose Origin is another site's is refused with 403 before
  // anything else, so a web page cannot drive the endpoint from a visitor's browser.
  const ownHostname = new URL(connectOrigin(request.url, process.env.NEXT_PUBLIC_SITE_URL)).hostname;
  const rejected = originValidationResponse(request, [ownHostname]);
  if (rejected !== undefined) return rejected;

  let headers: Record<string, string> = { ...NO_STORE };
  try {
    const { principal, rateLimit } = await authenticateApiRequest(request);
    headers = { ...headers, ...rateLimitHeaders(rateLimit) };
    const response = await handler.fetch(request, { authInfo: authInfoFor(principal) });
    const merged = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
  } catch (error) {
    // A Next.js control-flow error (notFound, redirect) belongs to Next.js, as in src/lib/api/route.ts.
    unstable_rethrow(error);
    return apiErrorResponse(error, headers);
  }
}
