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

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type EncryptionEnv = z.infer<typeof encryptionEnvSchema>;

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
