import { ArrowRightIcon } from "@/components/icons";
import { GitHubButton } from "@/components/github-button";
import { site } from "@/lib/site";

type CostSource = "Verified cost" | "Estimated cost" | "Allowance" | "Budget";

interface PreviewRow {
  provider: string;
  detail: string;
  value: string;
  source: CostSource;
  /** Share of the allowance or budget used, 0 to 100. Absent when there is no limit to compare against. */
  percentUsed?: number;
}

// Illustrative values only, labeled as such in the UI. Not real provider data.
const previewRows: readonly PreviewRow[] = [
  { provider: "Anthropic API", detail: "$22.80 of a $25 budget", value: "91%", source: "Budget", percentUsed: 91 },
  { provider: "Resend", detail: "Monthly emails · resets in 9 days", value: "75%", source: "Allowance", percentUsed: 75 },
  { provider: "ElevenLabs", detail: "Included credits · resets in 14 days", value: "68%", source: "Allowance", percentUsed: 68 },
  { provider: "GitHub Actions", detail: "Included minutes · resets in 21 days", value: "42%", source: "Allowance", percentUsed: 42 },
  { provider: "OpenAI API", detail: "Spent this month", value: "$14.50", source: "Verified cost" },
  { provider: "Vercel", detail: "Usage charges this month", value: "$12.30", source: "Verified cost" },
  { provider: "Supabase", detail: "Projected from usage and pricing", value: "$4.20", source: "Estimated cost" },
];

function barColor(percentUsed: number): string {
  if (percentUsed >= 90) return "bg-danger";
  if (percentUsed >= 75) return "bg-warning";
  return "bg-success";
}

// Entrance timing for the preview, after the figure's own rise-late. Rows stagger in, each bar
// fills just after its row lands, and the budget alert arrives once the 91% bar has filled, so
// the preview reads as the dashboard noticing the problem.
const ROW_START_MS = 350;
const ROW_STAGGER_MS = 80;
const BAR_AFTER_ROW_MS = 200;
const ALERT_DELAY_MS = 1500;

/** Hero: one promise, one primary action, and an honest picture of the dashboard. */
export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-20%] h-[480px] w-[min(720px,100vw)] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]"
      />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-6 pb-24 pt-14 sm:pt-20 lg:grid-cols-[1fr_1fr] lg:gap-10">
        <div>
          <p className="rise inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-xs text-muted">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
            Open source · In development
          </p>

          <h1
            id="hero-title"
            className="rise mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
          >
            {site.tagline}.
          </h1>

          <p className="rise-late mt-6 max-w-xl text-lg leading-8 text-muted">
            {site.name} brings the spending, usage, quotas, and activity of the services you build on
            into one dashboard. See what you have spent, how much allowance is left, and when it resets,
            and get an alert before a limit or budget becomes a problem.
          </p>

          <div className="rise-late mt-10 flex flex-wrap items-center gap-4">
            <GitHubButton />
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-lg border border-line px-5 py-3 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-foreground"
            >
              See how it works
              <ArrowRightIcon />
            </a>
          </div>
          <p className="rise-late mt-3 font-mono text-xs text-muted">
            Read-only access where providers allow it · self-hostable · hosted version planned
          </p>
        </div>

        <figure className="rise-late rounded-xl border border-line bg-panel shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <p className="text-sm font-medium">This month</p>
            <p className="font-mono text-xs text-muted">7 providers · synced 4 min ago</p>
          </div>

          <p
            className="rise-in mx-5 mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning"
            style={{ animationDelay: `${ALERT_DELAY_MS}ms` }}
          >
            <span aria-hidden="true">▲</span>
            Anthropic API passed 90% of your $25 monthly budget.
          </p>

          <ul className="divide-y divide-line px-5 py-2">
            {previewRows.map((row, index) => {
              const rowDelayMs = ROW_START_MS + index * ROW_STAGGER_MS;
              return (
                <li key={row.provider} className="rise-in py-3" style={{ animationDelay: `${rowDelayMs}ms` }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{row.provider}</span>
                    <span className="font-mono text-sm tabular-nums">{row.value}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
                    <span>{row.detail}</span>
                    <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide">
                      {row.source}
                    </span>
                  </div>
                  {row.percentUsed === undefined ? null : (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <div
                        className={`bar-fill h-full rounded-full ${barColor(row.percentUsed)}`}
                        style={{ width: `${row.percentUsed}%`, animationDelay: `${rowDelayMs + BAR_AFTER_ROW_MS}ms` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <figcaption className="border-t border-line px-5 py-3 text-xs text-muted">
            Example data. Every figure is labeled as verified, estimated, an allowance, or your own budget.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
