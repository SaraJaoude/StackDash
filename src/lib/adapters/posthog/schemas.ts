import { z } from "zod";

/**
 * Response schemas for the PostHog endpoints the adapter calls. Shapes are from the PostHog OpenAPI
 * reference and its frontend billing types (docs/providers/posthog.md, Sources); unknown fields are
 * dropped by `z.object`, which is how `account_owner` and the projects' `api_token` never reach
 * the adapter.
 */

const isoDateTime = z.iso.datetime({ offset: true }).transform((text) => new Date(text));
const count = z.int().nonnegative();
// Billing amounts are decimal strings in US dollars ("12.34"); null when not computed.
const usdAmount = z.string().nullable().optional();

// django-oauth-toolkit's token response plus PostHog's grant scoping (OAuth development guide,
// "Response includes"). The refresh token is optional: a response without one keeps the old one.
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  scoped_organizations: z.array(z.string()).nullable().optional(),
  scoped_teams: z.array(z.int()).nullable().optional(),
});

// RFC 6749 section 5.2 error body from the token endpoint.
export const OAuthErrorSchema = z.object({
  error: z.string().min(1),
});

// `GET /api/organizations/` (PaginatedOrganizationList). Only the id and name are kept.
export const OrganizationListSchema = z.object({
  count: count.optional(),
  next: z.string().nullable().optional(),
  results: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
    }),
  ),
});

// `GET /api/organizations/{organization_id}/projects/` (PaginatedProjectBackwardCompatBasicList).
// `id` is the environment (team) id the query endpoint takes; the project's `api_token` is dropped.
export const ProjectListSchema = z.object({
  count: count.optional(),
  next: z.string().nullable().optional(),
  results: z.array(
    z.object({
      id: z.int().positive(),
      name: z.string().min(1),
    }),
  ),
});

// One entry of `products` in `GET /api/billing/` (BillingProductV2Type in PostHog's frontend
// types; the OpenAPI schema leaves products untyped). Everything optional beyond the type and name,
// because free, paid, and inclusion-only products fill different fields.
const BillingProductSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  usage_key: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  current_usage: z.number().nonnegative().optional(),
  free_allocation: z.number().nonnegative().nullable().optional(),
  usage_limit: z.number().nonnegative().nullable().optional(),
  has_exceeded_limit: z.boolean().optional(),
  current_amount_usd: usdAmount,
  projected_amount_usd: usdAmount,
});

export const BillingResponseSchema = z.object({
  current_total_amount_usd: usdAmount,
  current_total_amount_usd_after_discount: usdAmount,
  projected_total_amount_usd: usdAmount,
  projected_total_amount_usd_after_discount: usdAmount,
  billing_period: z
    .object({
      current_period_start: isoDateTime,
      current_period_end: isoDateTime,
      interval: z.enum(["month", "year"]).optional(),
    })
    .nullable()
    .optional(),
  products: z.array(BillingProductSchema).optional(),
});

// `POST /api/projects/{project_id}/query/` with the signup HogQL query: one row per UTC day.
export const SignupQueryResponseSchema = z.object({
  results: z.array(z.tuple([z.iso.date(), count])),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type Organization = z.infer<typeof OrganizationListSchema>["results"][number];
export type Project = z.infer<typeof ProjectListSchema>["results"][number];
export type BillingResponse = z.infer<typeof BillingResponseSchema>;
export type BillingProduct = z.infer<typeof BillingProductSchema>;
