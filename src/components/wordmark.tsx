import Image from "next/image";

import { site } from "@/lib/site";

/** The StackDash wordmark without the domain, sized for the data-flow picture's center circle. */
export function Wordmark({ loading = "eager" }: { loading?: "eager" | "lazy" }) {
  return (
    <Image
      src="/brand/stackdash-logo-dark-no-tagline.svg"
      alt={site.name}
      width={377}
      height={76}
      className="h-5 w-auto sm:h-6"
      loading={loading}
      unoptimized
    />
  );
}
