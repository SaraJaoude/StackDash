import { Section } from "@/components/section";
import { site } from "@/lib/site";

interface IntegrationGroup {
  stage: string;
  dotClass: string;
  note: string;
  providers: readonly string[];
}

// Provisional order from the planning doc. The order depends on what each official API exposes.
const groups: readonly IntegrationGroup[] = [
  {
    stage: "First",
    dotClass: "bg-success",
    note: "Candidates for the first release",
    providers: ["Resend", "Vercel", "ElevenLabs", "GitHub and GitHub Actions"],
  },
  {
    stage: "Next",
    dotClass: "bg-warning",
    note: "Planned straight after",
    providers: ["OpenAI API", "Anthropic API", "Supabase"],
  },
  {
    stage: "Exploring",
    dotClass: "bg-muted",
    note: "Researching what official APIs allow",
    providers: ["Devin", "Brave Search API", "Stripe", "PayPal", "Cloudflare"],
  },
];

export function Integrations() {
  return (
    <Section
      id="integrations"
      eyebrow="Integrations"
      title="A few reliable integrations beat a long list of shaky ones"
      intro="Each integration will document exactly what it reads, which permissions it needs, how often it syncs, and what the provider does not expose. The order below is provisional and follows what each official API allows."
    >
      <div className="grid gap-6 md:grid-cols-3">
        {groups.map((group) => (
          <section
            key={group.stage}
            aria-labelledby={`integrations-${group.stage.toLowerCase()}`}
            className="rounded-xl border border-line bg-panel p-6"
          >
            <h3 id={`integrations-${group.stage.toLowerCase()}`} className="flex items-center gap-2 text-lg font-medium">
              <span className={`size-2 rounded-full ${group.dotClass}`} aria-hidden="true" />
              {group.stage}
            </h3>
            <p className="mt-1 text-sm text-muted">{group.note}</p>
            <ul className="mt-5 space-y-2.5">
              {group.providers.map((provider) => (
                <li key={provider} className="font-mono text-sm">
                  {provider}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-8 max-w-3xl rounded-xl border border-line bg-panel/60 px-5 py-4 text-sm leading-6 text-muted">
        <span className="font-medium text-foreground">About ChatGPT and Claude subscriptions.</span> Plans like
        ChatGPT Plus or Claude Pro are separate from API billing, and most do not offer a documented usage
        API. {site.name} will only show subscription usage where an official route exists. It will never
        scrape your sessions or ask for your password to fill the gap.
      </p>
    </Section>
  );
}
