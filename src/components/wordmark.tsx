import Image from "next/image";
import { site } from "@/lib/site";

interface WordmarkProps {
  withTagline?: boolean;
}

/** The official DevMacro wordmark for dark surfaces. */
export function Wordmark({ withTagline = false }: WordmarkProps) {
  return (
    <Image
      src={
        withTagline
          ? "/brand/devmacro-logo-dark.svg"
          : "/brand/devmacro-logo-dark-no-tagline.svg"
      }
      alt={withTagline ? `${site.name}, real-time dev data` : site.name}
      width={423}
      height={withTagline ? 118 : 96}
      className={withTagline ? "h-auto w-52" : "h-7 w-auto"}
      unoptimized
    />
  );
}
