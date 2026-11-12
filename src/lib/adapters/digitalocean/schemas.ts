import { z } from "zod";
import { InvalidDecimalError, parseDecimal } from "@/lib/money";

/**
 * Zod schemas for every DigitalOcean response the adapter reads (docs/providers/digitalocean.md,
 * from the OpenAPI specification at github.com/digitalocean/openapi, checked 2026-11-05).
 * Each one names only the fields the adapter uses: personal fields such as the account `email`
 * and `name`, the token `info.email`, app specs with their environment variables, and deployment
 * causes are dropped at this boundary by never being declared.
 */

const isoDateTime = z.iso.datetime({ offset: true }).transform((text) => new Date(text));

/** USD amounts arrive as decimal strings (`"12.34"`); parsed exactly, never kept as a float. */
const DecimalStringSchema = z.string().transform((value, ctx) => {
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

/**
 * `POST https://cloud.digitalocean.com/v1/oauth/token`, for both the authorization code and the
 * refresh grant ("The refresh token response is in the same format"). A refresh token is single
 * use and every response carries the next one, so a response without it is a shape change, not
 * "keep the old one". `info` is documented on both; only the team id is read.
 */
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
  info: z
    .object({
      team_uuid: z.string().min(1).optional(),
    })
    .optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/** `GET /v2/account`. `team` is present "when authorized in a team context". */
export const AccountResponseSchema = z.object({
  account: z.object({
    team: z
      .object({
        uuid: z.string().min(1),
        name: z.string(),
      })
      .optional(),
  }),
});

/** `GET /v2/customers/my/balance`. */
export const BalanceSchema = z.object({
  month_to_date_usage: DecimalStringSchema,
  account_balance: DecimalStringSchema,
  generated_at: isoDateTime,
});
export type Balance = z.infer<typeof BalanceSchema>;

/** The `links.pages` object DigitalOcean adds to a paginated list; `next` is absent on the last page. */
const LinksSchema = z
  .object({
    pages: z.object({ next: z.string().optional() }).optional(),
  })
  .optional();
export type PageLinks = z.infer<typeof LinksSchema>;

/** `YYYY-MM`, the billing month an invoice covers. */
const InvoicePeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a YYYY-MM billing month");

/** `GET /v2/customers/my/invoices`. The current month's preview is not read: `/balance` has it. */
export const InvoicesSchema = z.object({
  invoices: z
    .array(
      z.object({
        invoice_uuid: z.string().min(1),
        amount: DecimalStringSchema,
        invoice_period: InvoicePeriodSchema,
      }),
    )
    .optional(),
  links: LinksSchema,
});
export type Invoice = NonNullable<z.infer<typeof InvoicesSchema>["invoices"]>[number];

/** `GET /v2/customers/my/invoices/{invoice_uuid}`: one page of line items. */
export const InvoiceItemsSchema = z.object({
  invoice_items: z.array(
    z.object({
      product: z.string().min(1),
      amount: DecimalStringSchema,
    }),
  ),
  links: LinksSchema,
});

/** `GET /v2/billing/{account_urn}/insights/{start_date}/{end_date}`. */
export const InsightsSchema = z.object({
  data_points: z.array(
    z.object({
      usage_team_urn: z.string().min(1),
      start_date: z.iso.date(),
      total_amount: DecimalStringSchema,
      sku: z.string().min(1),
    }),
  ),
  total_pages: z.int().nonnegative(),
  current_page: z.int().nonnegative(),
});
export type InsightsDataPoint = z.infer<typeof InsightsSchema>["data_points"][number];

export const actionStatuses = ["in-progress", "completed", "errored"] as const;

/** `GET /v2/actions`. Ids are integers in the specification; only ever used as opaque keys. */
export const ActionsSchema = z.object({
  actions: z.array(
    z.object({
      id: z.int(),
      status: z.enum(actionStatuses),
      type: z.string().min(1),
      started_at: isoDateTime,
      completed_at: isoDateTime.nullish(),
      resource_id: z.int().nullish(),
      resource_type: z.string().min(1),
      region_slug: z.string().nullish(),
    }),
  ),
  links: LinksSchema,
});
export type Action = z.infer<typeof ActionsSchema>["actions"][number];

/** `GET /v2/droplets`: names only, to title droplet events. */
export const DropletsSchema = z.object({
  droplets: z.array(z.object({ id: z.int(), name: z.string() })),
  links: LinksSchema,
});

/** `GET /v2/apps`. Only the app id, its name, and when it last deployed are read. */
export const AppsSchema = z.object({
  apps: z
    .array(
      z.object({
        id: z.string().min(1),
        spec: z.object({ name: z.string().min(1) }),
        last_deployment_created_at: isoDateTime.optional(),
      }),
    )
    .optional(),
  links: LinksSchema,
});
export type App = NonNullable<z.infer<typeof AppsSchema>["apps"]>[number];

export const deploymentPhases = [
  "UNKNOWN",
  "PENDING_BUILD",
  "BUILDING",
  "PENDING_DEPLOY",
  "DEPLOYING",
  "ACTIVE",
  "SUPERSEDED",
  "ERROR",
  "CANCELED",
] as const;

const DeploymentSchema = z.object({
  id: z.string().min(1),
  phase: z.enum(deploymentPhases),
  created_at: isoDateTime,
  updated_at: isoDateTime.optional(),
  // The documentation example carries the zero time (`0001-01-01T00:00:00Z`) on a pending
  // deployment, so a value before `created_at` means "not set".
  phase_last_updated_at: isoDateTime.optional(),
  progress: z
    .object({
      success_steps: z.int().nonnegative().optional(),
      error_steps: z.int().nonnegative().optional(),
      total_steps: z.int().nonnegative().optional(),
    })
    .optional(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

/** `GET /v2/apps/{app_id}/deployments`. */
export const DeploymentsSchema = z.object({
  deployments: z.array(DeploymentSchema).optional(),
  links: LinksSchema,
});
