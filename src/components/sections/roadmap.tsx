import { Section } from "@/components/section";

interface Phase {
  name: string;
  summary: string;
  items: readonly string[];
}

const phases: readonly Phase[] = [
  {
    name: "First release",
    summary: "One timeline and one alert across your stack, with stats you choose to share and an API to read it all.",
    items: [
      "Provider connections through OAuth, no pasted keys",
      "Timeline of deploys, stars, signups, logins, payments, and errors",
      "Alerts by email, Slack, Discord, and webhook",
      "Daily and weekly digests on the same channels",
      "Percentage and dollar thresholds",
      "Publish chosen metrics, one at a time",
      "Opt-in public project pages",
      "README badges and shareable milestone cards",
      "A card of your year so far",
      "Read-only REST API with scoped keys",
      "Allowances, remaining quota, and reset dates",
      "Spend where the provider allows it",
      "Usage history",
    ],
  },
  {
    name: "Straight after",
    summary: "See what is coming, ask about it from your own tools, and run it yourself.",
    items: [
      "Spend forecasts",
      "Anomaly detection",
      "More integrations, starting with GitLab",
      "Read-only MCP server for AI assistants",
      "Open source release with self-hosting on Docker",
      "Team workspaces with owner, admin, and viewer roles",
      "Hide the event types you do not care about",
    ],
  },
  {
    name: "Later",
    summary: "Ideas we will build only if users ask for them.",
    items: ["Cost optimization suggestions", "Many more integrations"],
  },
];

export function Roadmap() {
  return (
    <Section
      id="roadmap"
      eyebrow="Roadmap"
      title="Small first release, clear next steps"
      intro="The first release covers the timeline, alerts, a read-only API, and badges, cards, and a public page for the stats you choose. Forecasts, anomaly detection, an MCP server, and self-hosting follow."
    >
      <ol className="grid gap-6 md:grid-cols-3">
        {phases.map((phase, index) => (
          <li key={phase.name} className="rounded-xl border border-line bg-panel p-6">
            <span className="font-mono text-xs text-muted">Phase {index + 1}</span>
            <h3 className="mt-2 text-lg font-medium">{phase.name}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{phase.summary}</p>
            <ul className="mt-5 space-y-2.5">
              {phase.items.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}
