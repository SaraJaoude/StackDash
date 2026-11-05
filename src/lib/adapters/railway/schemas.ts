import { z } from "zod";

/**
 * Zod schemas for every Railway response the adapter reads (docs/providers/railway.md). Each one
 * names only the fields the adapter uses: personal fields such as `email`, `name`, `avatar`, and
 * the deployment `creator` are never selected in a query and never declared here.
 */

// Railway's OAuth server; the callback `iss` must match it (docs/providers/railway.md, Authorize).
export const RAILWAY_ISSUER = "https://backboard.railway.com";

const isoDateTime = z.iso.datetime({ offset: true }).transform((text) => new Date(text));

/**
 * `POST /oauth/token`, for both the authorization code and the refresh grant. `offline_access`
 * with `prompt=consent` always returns a refresh token, and Railway rotates it, so a response
 * without one is a shape change, not "keep the old one". `id_token` is returned and ignored.
 */
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// RFC 6749 error body used by the token endpoint.
export const OAuthErrorSchema = z.object({
  error: z.string().min(1),
});

/**
 * The GraphQL envelope. Railway answers authorization denials with HTTP 200, an `errors` entry
 * whose message is "Not Authorized", and `data` null or partial (Public API, Errors).
 */
export const GraphqlEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z.object({ code: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

/** `me { workspaces { id name } }`: only the workspaces picked on the consent screen. */
export const WorkspacesDataSchema = z.object({
  me: z.object({
    workspaces: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  }),
});

export const ProjectsDataSchema = z.object({
  workspace: z.object({
    projects: z.object({
      edges: z.array(z.object({ node: z.object({ id: z.string().min(1), name: z.string() }) })),
      pageInfo: z.object({ hasNextPage: z.boolean() }),
    }),
  }),
});

export type RailwayProject = z.infer<typeof ProjectsDataSchema>["workspace"]["projects"]["edges"][number]["node"];

// Every value in the schema's DeploymentStatus enum (checked 2026-11-05). Unknown future values
// fail the parse rather than being guessed at.
export const deploymentStatuses = [
  "BUILDING",
  "CRASHED",
  "DEPLOYING",
  "FAILED",
  "INITIALIZING",
  "NEEDS_APPROVAL",
  "QUEUED",
  "REMOVED",
  "REMOVING",
  "SKIPPED",
  "SLEEPING",
  "SUCCESS",
  "WAITING",
] as const;

export type DeploymentStatus = (typeof deploymentStatuses)[number];

export const DeploymentSchema = z.object({
  id: z.string().min(1),
  status: z.enum(deploymentStatuses),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  statusUpdatedAt: isoDateTime.nullish(),
  // `Boolean!` in the schema: whether Railway can still roll back to this deployment.
  canRollback: z.boolean(),
  service: z.object({ name: z.string() }),
  environment: z.object({ name: z.string() }),
});

export type Deployment = z.infer<typeof DeploymentSchema>;

const DeploymentConnectionSchema = z.object({
  edges: z.array(z.object({ node: DeploymentSchema })),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().min(1).nullish() }),
});

/** One page of `deployments(input: { projectId })` per alias (`d0`, `d1`, ...). */
export const DeploymentsDataSchema = z.record(z.string().regex(/^d\d+$/), DeploymentConnectionSchema);

export const plans = ["FREE", "HOBBY", "PRO"] as const;

export type RailwayPlan = (typeof plans)[number];

// The measurements the adapter reads; DISK_USAGE_GB is volume storage (docs/providers/railway.md).
export const measurements = ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB", "DISK_USAGE_GB"] as const;

export type Measurement = (typeof measurements)[number];

const amount = z.number();

export const BillingDataSchema = z.object({
  workspace: z.object({
    plan: z.enum(plans),
    customer: z.object({
      billingPeriod: z.object({ start: isoDateTime, end: isoDateTime }),
      currentUsage: amount.nonnegative(),
      creditBalance: amount,
    }),
  }),
  usage: z.array(z.object({ measurement: z.enum(measurements), value: z.number().nonnegative() })),
  estimatedUsage: z.array(
    z.object({ measurement: z.enum(measurements), estimatedValue: z.number().nonnegative(), projectId: z.string() }),
  ),
});

export type BillingData = z.infer<typeof BillingDataSchema>;
