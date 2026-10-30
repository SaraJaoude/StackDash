import { Section } from "@/components/section";
import { site } from "@/lib/site";

type Provenance = "Verified" | "Estimated" | "Self-reported";

interface PublicMetric {
  label: string;
  value: string;
  provenance: Provenance;
}

// Illustrative values only, labeled as such in the UI.
const publicMetrics: readonly PublicMetric[] = [
  { label: "GitHub stars", value: "1,000", provenance: "Verified" },
  { label: "Production deployments this month", value: "12", provenance: "Verified" },
  { label: "Monthly active users", value: "340", provenance: "Estimated" },
  { label: "Registered users", value: "1,250", provenance: "Self-reported" },
];

const PROVENANCE_CLASSES: Record<Provenance, string> = {
  Verified: "border-success/40 text-success",
  Estimated: "border-warning/40 text-warning",
  "Self-reported": "border-line text-muted",
};

interface Stage {
  name: string;
  body: string;
}

const stages: readonly Stage[] = [
  {
    name: "Milestone cards",
    body: "Pick a metric you are proud of and get an image to post on X, LinkedIn, or Reddit. No public page needed.",
  },
  {
    name: "Public project pages",
    body: "An opt-in page with the metrics you choose, growth history, and a timeline of milestones.",
  },
  {
    name: "Discovery and badges",
    body: "A project directory and README badges, only if people want them. Not a social network.",
  },
];

const privacyRules: readonly string[] = [
  "Everything is private until you publish it, one metric at a time.",
  "Keys, tokens, private repository activity, and infrastructure details can never be published.",
  "Spending, budgets, and billing are never shared automatically.",
  "Delay or round a number before it goes public, and stop sharing whenever you like.",
];

export function ShareProgress() {
  return (
    <Section
      id="share"
      eyebrow="Build in public · Exploring"
      title="Show your progress, not just your revenue"
      intro={`A project with little or no income can still show real traction: users, usage, contributors, and steady shipping. After the first release, ${site.name} may let you share the milestones you choose, backed by your connected accounts. This is optional and off by default.`}
    >
      <div className="grid gap-10 lg:grid-cols-2">
        <figure className="self-start rounded-xl border border-line bg-panel">
          <div className="border-b border-line p-6">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-10 items-center justify-center rounded-lg bg-accent-soft font-mono text-sm font-semibold text-accent"
              >
                A
              </span>
              <div>
                <p className="text-sm font-medium">acme-api</p>
                <p className="font-mono text-xs text-muted">Milestone reached 2026-10-12</p>
              </div>
            </div>
            <p className="mt-6 text-3xl font-semibold tracking-tight">1,000 GitHub stars</p>
            <p className="mt-2 text-sm text-muted">Up 38% in the last 30 days</p>
          </div>

          <dl className="divide-y divide-line px-6">
            {publicMetrics.map((metric) => (
              <div key={metric.label} className="flex items-center justify-between gap-3 py-3">
                <dt className="text-sm text-muted">{metric.label}</dt>
                <dd className="flex items-center gap-3">
                  <span className="font-mono text-sm tabular-nums">{metric.value}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${PROVENANCE_CLASSES[metric.provenance]}`}
                  >
                    {metric.provenance}
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          <figcaption className="border-t border-line px-6 py-3 text-xs text-muted">
            Example data. Shared with {site.name}.
          </figcaption>
        </figure>

        <div>
          <h3 className="text-xl font-semibold tracking-tight">Verified means sourced, not proven</h3>
          <p className="mt-3 text-sm leading-6 text-muted">
            Verified numbers come straight from a connected provider. Estimated numbers are calculated from
            provider data, and self-reported numbers are typed in by the owner. A verified count still does not
            prove unique people or a working business, so every public metric shows its definition and when it
            last updated. Usage that only measures cost, like bandwidth, is not treated as a milestone.
          </p>

          <ol className="mt-8 space-y-4">
            {stages.map((stage, index) => (
              <li key={stage.name} className="flex gap-4">
                <span className="font-mono text-xs leading-6 text-muted">0{index + 1}</span>
                <div>
                  <p className="text-sm font-medium">{stage.name}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{stage.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <h3 className="mt-10 text-base font-medium">Private by default</h3>
          <ul className="mt-4 space-y-2.5">
            {privacyRules.map((rule) => (
              <li key={rule} className="flex items-start gap-3 text-sm leading-6 text-muted">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {rule}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
