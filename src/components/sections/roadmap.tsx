import { Section } from "@/components/section";

interface Phase {
  name: string;
  summary: string;
  items: readonly string[];
}

const phases: readonly Phase[] = [
  {
    name: "First release",
    summary: "Prove that one view of usage and spend is worth connecting accounts for.",
    items: [
      "Usage and spending dashboard",
      "Allowances, remaining quota, and reset dates",
      "Percentage and dollar thresholds",
      "Daily usage summaries",
      "Activity timeline with filters",
      "Usage history",
      "Self-hosting with Docker",
    ],
  },
  {
    name: "Straight after",
    summary: "Share it with a team and query it from your own tools.",
    items: [
      "Team workspaces with owner, admin, and viewer roles",
      "Public REST API with scoped keys",
      "Read-only MCP server for AI assistants",
    ],
  },
  {
    name: "Later",
    summary: "Ideas we will build only if users ask for them.",
    items: [
      "Anomaly detection and spend forecasts",
      "Alerts by email, Slack, Discord, and webhook",
      "Cost optimization suggestions",
      "Many more integrations",
    ],
  },
];

export function Roadmap() {
  return (
    <Section
      id="roadmap"
      eyebrow="Roadmap"
      title="Small first release, clear next steps"
      intro="The first release stays focused. Teams, an API, and MCP follow once the core is solid."
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
