import { PlatformLogo, PuzzleIcon } from "@/components/icons";
import type { ProviderId } from "@/lib/adapters/types";
import type { Platform } from "@/lib/site";

// The fake provider has no brand, so it gets the generic puzzle mark.
const PLATFORM: Record<ProviderId, Platform | null> = {
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
  fake: null,
};

const FRAME_CLASSES = {
  md: "size-10 rounded-lg",
  sm: "size-7 rounded-md",
} as const;

/** Decorative provider mark; the provider name is always printed (or read out) beside it. */
export function ProviderMark({
  provider,
  size = 20,
  frame = "md",
}: {
  provider: ProviderId;
  size?: number;
  frame?: keyof typeof FRAME_CLASSES;
}) {
  const platform = PLATFORM[provider];
  return (
    <span
      className={`flex shrink-0 items-center justify-center border border-line bg-panel-raised text-foreground ${FRAME_CLASSES[frame]}`}
    >
      {platform === null ? (
        <PuzzleIcon width={size} height={size} />
      ) : (
        <PlatformLogo platform={platform} width={size} height={size} />
      )}
    </span>
  );
}
