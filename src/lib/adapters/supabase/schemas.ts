import { z } from "zod";

/**
 * Response schemas for the Supabase Management API, from docs/providers/supabase.md.
 * Unknown fields are dropped by `z.object`; the log rows use `z.strictObject` on purpose
 * (see `logsResponseSchema`).
 */

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  // Optional in the OpenAPI schema; returned for the authorization code grant per the guide.
  refresh_token: z.string().min(1).optional(),
  expires_in: z.int().positive(),
  token_type: z.string().min(1),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const OrganizationsSchema = z.array(
  z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
  }),
);

export const OrganizationProjectsSchema = z.object({
  projects: z.array(
    z.object({
      ref: z.string().min(1),
      name: z.string().min(1),
      status: z.string().min(1),
      is_branch: z.boolean(),
    }),
  ),
  pagination: z.object({
    count: z.int().nonnegative(),
    limit: z.int().positive(),
    offset: z.int().nonnegative(),
  }),
});

// `GET /v1/projects/{ref}`: same project shape as `GET /v1/projects` (page, "Organizations and
// projects"), which carries `organization_slug`.
export const ProjectSchema = z.object({
  ref: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  organization_slug: z.string().min(1),
});
export type Project = z.infer<typeof ProjectSchema>;

export const OrganizationSchema = z.object({
  // A string rather than an enum so a new plan name does not fail the whole sync.
  plan: z.string().min(1).optional(),
});

export const EntitlementsSchema = z.object({
  entitlements: z.array(
    z.object({
      feature: z.object({ key: z.string().min(1), type: z.string().min(1) }),
      hasAccess: z.boolean(),
      type: z.string().min(1),
      // Shape depends on `type`; numeric configs are parsed with `NumericEntitlementConfigSchema`.
      config: z.unknown(),
    }),
  ),
});

export const NumericEntitlementConfigSchema = z.object({
  enabled: z.boolean(),
  value: z.number().nonnegative(),
  unlimited: z.boolean(),
  unit: z.string(),
});

export const HealthSchema = z.array(
  z.object({
    name: z.string().min(1),
    status: z.enum(["COMING_UP", "ACTIVE_HEALTHY", "UNHEALTHY"]),
  }),
);
export type ServiceHealth = z.infer<typeof HealthSchema>[number];

/**
 * Whether `count()` arrives as a number or a string is unverified (page, Unverified: "Field value
 * types in the logs `result` array"), so both are accepted.
 */
const CountSchema = z.union([
  z.int().nonnegative(),
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(Number.isSafeInteger, "count is too large"),
]);

/** A log timestamp normalized to microsecond precision, used for ordering and dedupe keys. */
export type LogTimestamp = Readonly<{ at: Date; key: string }>;

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)?$/;

function fromMicroseconds(micros: number): LogTimestamp {
  const ms = Math.floor(micros / 1000);
  const iso = new Date(ms).toISOString();
  return { at: new Date(ms), key: `${iso.slice(0, 23)}${String(micros % 1000).padStart(3, "0")}Z` };
}

function fromText(text: string): LogTimestamp | undefined {
  const match = TIMESTAMP_PATTERN.exec(text);
  if (match === null) return undefined;
  const [, date, time, fraction = ""] = match;
  const micros = fraction.padEnd(6, "0").slice(0, 6);
  const at = new Date(`${date}T${time}.${micros.slice(0, 3)}Z`);
  if (Number.isNaN(at.getTime())) return undefined;
  return { at, key: `${date}T${time}.${micros}Z` };
}

/**
 * `timestamp` is a UTC `DateTime64`. Whether it arrives as text or epoch microseconds is
 * unverified (page, Unverified: "Field value types in the logs `result` array"), so both are read.
 */
const LogTimestampSchema = z
  .union([z.string(), z.int().nonnegative()])
  .transform((value, ctx): LogTimestamp => {
    const parsed = typeof value === "number" ? fromMicroseconds(value) : fromText(value);
    if (parsed === undefined) {
      ctx.issues.push({ code: "custom", message: "timestamp is not a UTC date and time", input: value });
      return z.NEVER;
    }
    return parsed;
  });

export const authActions = ["user_signedup", "login", "logout", "user_deleted", "token_refreshed"] as const;

// Strict rows: the page's privacy rule is to accept only the expected aggregate columns and reject
// anything else (an email, IP address, or user id) instead of storing it.
export const ActionCountRowSchema = z.strictObject({
  action: z.enum(authActions),
  events: CountSchema,
});

export const SignupRowSchema = z.strictObject({
  timestamp: LogTimestampSchema,
});

export const ActiveUsersRowSchema = z.strictObject({
  active_users: CountSchema,
});

/** `{ result: unknown[], error?: string | { code, errors[], message, status } }` with typed rows. */
export function logsResponseSchema<Row extends z.ZodType>(row: Row) {
  return z.object({
    result: z.array(row).optional(),
    error: z.union([z.string(), z.object({ message: z.string().optional() })]).nullish(),
  });
}
