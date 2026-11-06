import "server-only";

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

import { authenticateApiRequest, rateLimitHeaders, requireApiScope } from "@/lib/api/auth";
import type { ApiEndpoint } from "@/lib/api/endpoints";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";

/*
 * The GET handler behind every /api/v1 route (#162). In order: authenticate the bearer key (401,
 * 429), check the endpoint's scope (403), validate the query string (400), then load one page.
 * Bearer only by design: nothing reads cookies and no CORS header is sent, so the API serves
 * scripts and servers, not other sites' pages, and needs no CSRF defense. Every answer is
 * `no-store`, because each one depends on the key that asked.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

function issueMessage(issue: z.core.$ZodIssue, accepted: readonly string[]): string {
  if (issue.code === "unrecognized_keys") {
    const allowed = accepted.length === 0 ? "This endpoint takes no parameters." : `It accepts ${accepted.join(", ")}.`;
    return `Unknown parameter ${issue.keys.join(", ")}. ${allowed}`;
  }
  return `The ${issue.path.join(".")} parameter is not valid: ${issue.message}.`;
}

/** The query string checked against `schema`. Each parameter may appear once. */
export function parseApiQuery<Query extends z.ZodObject>(url: URL, schema: Query): z.output<Query> {
  const params: Record<string, string> = {};
  for (const [name, value] of url.searchParams) {
    if (Object.hasOwn(params, name)) throw invalidRequest(`Pass the ${name} parameter once.`);
    params[name] = value;
  }
  const parsed = schema.safeParse(params);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw invalidRequest(
    issue === undefined ? "The query parameters are not valid." : issueMessage(issue, Object.keys(schema.shape)),
  );
}

export function apiGet<Query extends z.ZodObject, Item extends z.ZodType>(endpoint: ApiEndpoint<Query, Item>) {
  return async function GET(request: Request): Promise<Response> {
    let headers: Record<string, string> = { ...NO_STORE };
    try {
      const { principal, rateLimit } = await authenticateApiRequest(request);
      headers = { ...headers, ...rateLimitHeaders(rateLimit) };
      if (endpoint.scope !== null) requireApiScope(principal, endpoint.scope);
      const query = parseApiQuery(new URL(request.url), endpoint.query);
      return Response.json(await endpoint.load(principal.tokenHash, query), { headers });
    } catch (error) {
      // Next.js stops prerendering at build by throwing when the handler reads the request; that
      // signal (and notFound or redirect) belongs to Next.js, not to the API's error envelope.
      unstable_rethrow(error);
      return apiErrorResponse(error, headers);
    }
  };
}
