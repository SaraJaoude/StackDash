import { z } from "zod";
import { InvalidDecimalError, parseDecimal } from "@/lib/money";

/**
 * Zod schemas for every Vercel response the adapter reads (docs/providers/vercel.md).
 * Each one names only the fields the adapter uses: personal fields such as `creator.email`,
 * `creator.username`, and Git `meta` are dropped at this boundary by never being declared.
 */

/**
 * Unix milliseconds. The OpenAPI schema types these as numbers while the documentation examples
 * render them as strings, so both are accepted.
 */
const EpochMsSchema = z
  .union([z.int(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.int().nonnegative());

/**
 * FOCUS amounts. Typed as numbers in the schema and rendered as strings in the documentation
 * example; the precision is unverified (docs/providers/vercel.md, Unverified), so both shapes are
 * parsed into an exact decimal and never kept as a float.
 */
const DecimalAmountSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  try {
    return parseDecimal(value);
  } catch (error) {
    if (error instanceof InvalidDecimalError) {
      ctx.addIssue({ code: "custom", message: error.message });
      return z.NEVER;
    }
    throw error;
  }
});

/** `POST /v2/oauth/access_token`. No `expires_in` and no `refresh_token`: the token is long-lived. */
export const TokenResponseSchema = z.object({
  token_type: z.string().min(1),
  access_token: z.string().min(1),
  installation_id: z.string().min(1),
  user_id: z.string().min(1),
  // Null when installed on a Hobby account.
  team_id: z.string().min(1).nullable(),
});

/** `GET /v2/teams/{teamId}`. */
export const TeamSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().nullish(),
});

export const chargeCategories = ["Usage", "Purchase", "Tax", "Credit", "Adjustment"] as const;

/** One JSONL line from `GET /v1/billing/charges` (FOCUS v1.3). */
export const BillingChargeSchema = z.object({
  BilledCost: DecimalAmountSchema,
  BillingCurrency: z.string().min(1),
  ChargeCategory: z.enum(chargeCategories),
});

export const BillingChargesSchema = z.array(BillingChargeSchema);

export type BillingCharge = z.infer<typeof BillingChargeSchema>;

export const deploymentReadyStates = [
  "BLOCKED",
  "BUILDING",
  "CANCELED",
  "DELETED",
  "ERROR",
  "INITIALIZING",
  "QUEUED",
  "READY",
] as const;

const DeploymentSchema = z.object({
  uid: z.string().min(1),
  name: z.string().min(1),
  readyState: z.enum(deploymentReadyStates),
  target: z.string().nullish(),
  created: EpochMsSchema,
  ready: EpochMsSchema.nullish(),
  errorCode: z.string().nullish(),
  inspectorUrl: z.string().nullish(),
});

/** `GET /v7/deployments`. `pagination.next` is the `until` value for the next (older) page. */
export const DeploymentsPageSchema = z.object({
  deployments: z.array(DeploymentSchema),
  pagination: z.object({
    next: EpochMsSchema.nullish(),
  }),
});

export type Deployment = z.infer<typeof DeploymentSchema>;
