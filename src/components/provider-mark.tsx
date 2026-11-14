import { PlatformLogo } from "@/components/icons";
import type { Platform } from "@/lib/site";

const SIZES = {
  sm: { frame: "size-7 rounded-md", icon: "size-4" },
  md: { frame: "size-8 rounded-md", icon: "size-4" },
  lg: { frame: "size-10 rounded-lg", icon: "size-5" },
} as const;

/** A platform's brand logo in a framed square. Decorative: the name is printed beside it. */
export function ProviderMark({
  platform,
  size = "lg",
  className = "",
}: {
  platform: Platform;
  size?: keyof typeof SIZES;
  /** Placement only, such as `mt-0.5`. */
  className?: string;
}) {
  const { frame, icon } = SIZES[size];
  return (
    <span
      className={`flex shrink-0 items-center justify-center border border-line bg-panel-raised text-foreground ${frame} ${className}`.trim()}
    >
      <PlatformLogo platform={platform} className={icon} />
    </span>
  );
}
