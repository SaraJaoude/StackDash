import Image from "next/image";

import { site } from "@/lib/site";

interface WordmarkProps {
  loading?: "eager" | "lazy";
  size?: "compact" | "site";
}

const sizeClasses: Record<NonNullable<WordmarkProps["size"]>, string> = {
  compact: "h-5 w-auto",
  site: "h-7 w-auto",
};

/** The official DevMacro wordmark, sized for compact app chrome or the public site. */
export function Wordmark({ loading = "eager", size = "compact" }: WordmarkProps) {
  return (
    <Image
      src="/brand/devmacro-logo-dark-no-tagline.svg"
      alt={site.name}
      width={423}
      height={96}
      className={sizeClasses[size]}
      loading={loading}
      unoptimized
    />
  );
}
