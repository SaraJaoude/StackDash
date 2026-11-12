import type { Metadata } from "next";

import { Faq } from "@/components/sections/faq";
import { Features } from "@/components/sections/features";
import { FinalCta } from "@/components/sections/final-cta";
import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Integrations } from "@/components/sections/integrations";
import { OpenSource } from "@/components/sections/open-source";
import { Problem } from "@/components/sections/problem";
import { Roadmap } from "@/components/sections/roadmap";
import { Security } from "@/components/sections/security";
import { ShareProgress } from "@/components/sections/share-progress";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { site } from "@/lib/site";
import { LANDING_TITLE, socialMetadata } from "@/lib/site-metadata";

// The title and description are the root layout's defaults; this adds the page's own address.
export const metadata: Metadata = socialMetadata({ title: LANDING_TITLE, description: site.description, path: "/" });

// Fully static: no request data, so the whole page prerenders at build time.
export default function Home() {
  return (
    <>
      <SiteNav />
      <main id="main" className="flex-1">
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <Integrations />
        <Security />
        <OpenSource />
        <ShareProgress />
        <Roadmap />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
