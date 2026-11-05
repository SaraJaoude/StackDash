import { buildOpenApiDocument } from "@/lib/api/openapi";

// The OpenAPI document for /api/v1 (#162). It reads no request data, so with Cache Components it
// is prerendered at build time ("Route Handlers", With Cache Components) and served statically.
export function GET(): Response {
  return Response.json(buildOpenApiDocument());
}
