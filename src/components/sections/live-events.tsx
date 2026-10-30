import { LiveEventFeed } from "@/components/live-event-feed";
import { Section } from "@/components/section";

const sources: readonly string[] = [
  "Deployments and failed builds from Vercel and GitHub Actions",
  "Merged pull requests and published releases from GitHub",
  "Payments and failed renewals from Stripe",
  "Usage and budget thresholds from OpenAI API, Anthropic API, Resend, Supabase, ElevenLabs, and Cloudflare",
];

export function LiveEvents() {
  return (
    <Section
      id="live-events"
      eyebrow="Live events"
      title="Every platform's events, in one feed, as they happen"
      intro="Stop refreshing five dashboards to find out what changed. Events from each connected platform arrive in one feed, newest first, each one naming where it came from."
    >
      <div className="grid items-start gap-10 lg:grid-cols-2">
        <div>
          <ul className="space-y-3">
            {sources.map((source) => (
              <li key={source} className="flex items-start gap-3 text-sm leading-6 text-muted">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {source}
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-xl rounded-xl border border-line bg-panel/60 px-5 py-4 text-sm leading-6 text-muted">
            Signed webhooks deliver an event the moment a provider sends it. Providers without webhooks
            report on their next scheduled sync.
          </p>
        </div>
        <LiveEventFeed />
      </div>
    </Section>
  );
}
