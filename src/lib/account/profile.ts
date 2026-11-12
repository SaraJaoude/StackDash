import { z } from "zod";

/*
 * Who is signed in, for the workspace header (#175): the GitHub display name and avatar that
 * Supabase Auth copies into the user's metadata at every GitHub sign-in. It is read from the
 * verified access token's claims, so no second profile store and no extra request.
 */

export type AccountProfile = Readonly<{
  /** The GitHub display name, else the GitHub username, else null. */
  name: string | null;
  /** A GitHub avatar URL the app's CSP allows (img-src in src/proxy.ts), else null. */
  avatarUrl: string | null;
}>;

// The only image host the app routes' CSP allows; an avatar elsewhere would render broken.
const AVATAR_HOST = "avatars.githubusercontent.com";
// The header shows the avatar at 28 CSS pixels; 64 covers a 2x screen. GitHub resizes on `s`.
const AVATAR_SIZE_PX = "64";

// Metadata is whatever the provider (or the user, through updateUser) wrote, so a field of the
// wrong type or a blank one counts as absent rather than failing the header.
const field = z.string().trim().min(1).optional().catch(undefined);

// GitHub's display name lands in `full_name` and `name`, the login in `user_name` and
// `preferred_username`. A GitHub account without a display name has only the login.
const metadataSchema = z
  .object({
    full_name: field,
    name: field,
    user_name: field,
    preferred_username: field,
    avatar_url: field,
  })
  .catch({});

function githubAvatar(raw: string | undefined): string | null {
  if (raw === undefined || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.host !== AVATAR_HOST) return null;
  url.searchParams.set("s", AVATAR_SIZE_PX);
  return url.toString();
}

/** The profile in Supabase Auth's `user_metadata` for a GitHub sign-in. */
export function accountProfile(metadata: unknown): AccountProfile {
  const fields = metadataSchema.parse(metadata);
  return {
    name: fields.full_name ?? fields.name ?? fields.user_name ?? fields.preferred_username ?? null,
    avatarUrl: githubAvatar(fields.avatar_url),
  };
}
