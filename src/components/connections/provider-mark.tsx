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
  polar: "Polar",
  fake: null,
};

/** Decorative provider mark; the provider name is always printed beside it. */
export function ProviderMark({ provider, size = 20 }: { provider: ProviderId; size?: number }) {
  const platform = PLATFORM[provider];
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-raised text-foreground">
      {platform === null ? (
        <PuzzleIcon width={size} height={size} />
      ) : (
        <PlatformLogo platform={platform} width={size} height={size} />
      )}
    </span>
  );
}
