import type { Platform } from "@/lib/site";

/** The sources the hero's data-flow picture shows, in main's `liveProviderIds` order. */
export const sourceIds = ["vercel", "github", "resend", "stripe", "supabase", "digitalocean", "posthog", "polar", "sentry", "railway", "gitlab"] as const;

export type SourceId = (typeof sourceIds)[number];

/** Each source's brand, which is also its display name. */
export const SOURCE_PLATFORMS: Record<SourceId, Platform> = {
  vercel: "Vercel",
  github: "GitHub",
  resend: "Resend",
  stripe: "Stripe",
  supabase: "Supabase",
  digitalocean: "DigitalOcean",
  posthog: "PostHog",
  polar: "Polar",
  sentry: "Sentry",
  railway: "Railway",
  gitlab: "GitLab",
};
