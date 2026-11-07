import { z } from "zod";

// Accessors are functions rather than module-level constants so that importing this module never
// reads the environment: `next build` prerenders static pages without any Supabase variables set.

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

// Only presence is checked here; the key format (base64 of exactly 32 bytes, `keyId:base64` pairs)
// is validated in `src/lib/crypto/credentials.ts`, which owns the keyring and its error messages.
const encryptionEnvSchema = z.object({
  DEVMACRO_ENCRYPTION_KEY: z.string().min(1),
  DEVMACRO_ENCRYPTION_KEYS_PREVIOUS: z.string().min(1).optional(),
});

/**
 * True for an http(s) URL whose host is this computer: `localhost`, any 127.x.x.x address, or
 * `[::1]`. The WHATWG parser has already normalized the host (`127.1` is `127.0.0.1`, user info
 * is split off), so a name that only starts with a loopback address is refused.
 */
export function isLoopbackUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  return host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

// Alert email (#152). Exactly one transport: SMTP for local and self-hosted installs (the local
// Supabase mail catcher listens on SMTP), or Resend's HTTP API for the hosted instance. Neither set
// means email is not set up on this instance; alerts still reach the app and the channels.
const emailEnvSchema = z
  .object({
    DEVMACRO_EMAIL_FROM: z.string().trim().min(3),
    DEVMACRO_SMTP_URL: z.url({ protocol: /^smtps?$/, error: "use smtp://host:port or smtps://user:password@host:port" }).optional(),
    DEVMACRO_RESEND_API_KEY: z.string().min(1).optional(),
  })
  .refine((env) => env.DEVMACRO_SMTP_URL === undefined || env.DEVMACRO_RESEND_API_KEY === undefined, {
    path: ["DEVMACRO_RESEND_API_KEY"],
    error: "set either DEVMACRO_SMTP_URL or DEVMACRO_RESEND_API_KEY, not both",
  });

// Where the public routes' per IP rate limit (#149) finds the client. VERCEL=1 is Vercel's system
// environment variable (https://vercel.com/docs/environment-variables/system-environment-variables).
// Elsewhere DEVMACRO_TRUSTED_PROXY_COUNT is how many proxies in front of the app append to
// x-forwarded-for; one when unset.
const clientIpEnvSchema = z.object({
  VERCEL: z.string().optional(),
  DEVMACRO_TRUSTED_PROXY_COUNT: z
    .string()
    .regex(/^[1-9]$/, "use a whole number from 1 to 9: the proxies in front of the app that append to x-forwarded-for")
    .optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type EncryptionEnv = z.infer<typeof encryptionEnvSchema>;
export type EmailEnv =
  | Readonly<{ transport: "smtp"; from: string; smtpUrl: string }>
  | Readonly<{ transport: "resend"; from: string; resendApiKey: string }>;
export type ClientIpEnv = Readonly<{ header: "x-vercel-forwarded-for" | "x-forwarded-for"; trustedProxies: number }>;

function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  input: Record<string, string | undefined>,
): z.infer<Schema> {
  // Empty strings come from blank lines in .env files; treat them as missing, not as values.
  const present = Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "",
    ),
  );
  const result = schema.safeParse(present);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join(".");
    return name in present ? `${name} is invalid: ${issue.message}` : `${name} is not set`;
  });
  throw new Error(
    `Environment configuration error: ${problems.join("; ")}. See .env.example for where each value comes from.`,
    { cause: result.error },
  );
}

/**
 * Public Supabase settings, safe to expose to the browser.
 *
 * Each variable is read with a literal `process.env.NEXT_PUBLIC_*` expression because Next.js only
 * inlines public variables into client bundles when referenced that way.
 */
export function publicEnv(): PublicEnv {
  return parseEnv(publicEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

/**
 * Secret server settings. Callers must be server-only modules (see `src/lib/supabase/admin.ts`);
 * the browser guard is a second line of defense in case one is imported into client code.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser. Secret variables are server only.");
  }
  return parseEnv(serverEnvSchema, {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

/**
 * Credential encryption keys. Separate from `serverEnv()` so that code which only needs the
 * service role (most of the server) does not fail when the encryption key is absent; only the
 * credential paths require it.
 */
export function encryptionEnv(): EncryptionEnv {
  if (typeof window !== "undefined") {
    throw new Error("encryptionEnv() was called in the browser. Secret variables are server only.");
  }
  return parseEnv(encryptionEnvSchema, {
    DEVMACRO_ENCRYPTION_KEY: process.env.DEVMACRO_ENCRYPTION_KEY,
    DEVMACRO_ENCRYPTION_KEYS_PREVIOUS: process.env.DEVMACRO_ENCRYPTION_KEYS_PREVIOUS,
  });
}

/**
 * The alert email transport, or null when neither DEVMACRO_SMTP_URL nor DEVMACRO_RESEND_API_KEY is
 * set. A transport without DEVMACRO_EMAIL_FROM, or both transports at once, is a configuration
 * error rather than a silent "off".
 */
export function emailEnv(): EmailEnv | null {
  if (typeof window !== "undefined") {
    throw new Error("emailEnv() was called in the browser. Secret variables are server only.");
  }
  const input = {
    DEVMACRO_EMAIL_FROM: process.env.DEVMACRO_EMAIL_FROM,
    DEVMACRO_SMTP_URL: process.env.DEVMACRO_SMTP_URL,
    DEVMACRO_RESEND_API_KEY: process.env.DEVMACRO_RESEND_API_KEY,
  };
  if (!input.DEVMACRO_SMTP_URL && !input.DEVMACRO_RESEND_API_KEY) return null;
  const env = parseEnv(emailEnvSchema, input);
  if (env.DEVMACRO_SMTP_URL !== undefined) {
    return { transport: "smtp", from: env.DEVMACRO_EMAIL_FROM, smtpUrl: env.DEVMACRO_SMTP_URL };
  }
  if (env.DEVMACRO_RESEND_API_KEY !== undefined) {
    return { transport: "resend", from: env.DEVMACRO_EMAIL_FROM, resendApiKey: env.DEVMACRO_RESEND_API_KEY };
  }
  return null;
}

/**
 * Which request header holds the client IP and how many proxies appended to it. On Vercel,
 * `x-vercel-forwarded-for`, which Vercel sets to the client it saw and a proxy in front of Vercel
 * cannot overwrite (https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).
 * Self-hosted, `x-forwarded-for` with DEVMACRO_TRUSTED_PROXY_COUNT proxies appending to it.
 */
export function clientIpEnv(): ClientIpEnv {
  const env = parseEnv(clientIpEnvSchema, {
    VERCEL: process.env.VERCEL,
    DEVMACRO_TRUSTED_PROXY_COUNT: process.env.DEVMACRO_TRUSTED_PROXY_COUNT,
  });
  if (env.VERCEL === "1") return { header: "x-vercel-forwarded-for", trustedProxies: 1 };
  return { header: "x-forwarded-for", trustedProxies: Number(env.DEVMACRO_TRUSTED_PROXY_COUNT ?? "1") };
}
