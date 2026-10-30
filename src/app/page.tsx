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
import { SiteNav } from "@/components/site-nav";

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
        <Roadmap />
        <Faq />
        <FinalCta />
      </main>
    </>
  );
}
