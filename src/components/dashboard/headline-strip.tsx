import Link from "next/link";
import { useId, type ReactNode } from "react";

import { SimulatedBadge } from "@/components/connections/simulated-badge";
import {
  costPerSignupExplanation,
  formatCount,
  HEADLINE_WINDOW_KINDS,
  headlineChoiceLabel,
  headlineComparisonText,
  headlineEmptyNote,
  headlineFallbackNote,
  headlineTitle,
  moneyFormatter,
  wholeDaysNote,
  windowDescription,
  type ComparisonGap,
  type CostPerSignupFigure,
  type CountFigure,
  type DeploysFigure,
  type FigureSources,
  type FigureValue,
  type HeadlineStrip as Strip,
  type HeadlineView,
  type HeadlineWindowKind,
  type HeadlineWindowLabel,
  type MoneyFigure,
  type MoneyLine,
} from "@/lib/dashboard/headline";
import { formatList, formatQuantity } from "@/lib/format";

import { InfoTooltip } from "./info-tooltip";
import { ProvenanceBadge, Unavailable } from "./value-meta";

const ESTIMATED = { status: "estimated", pricingSources: [] } as const;
const VERIFIED = { status: "verified" } as const;

/** One labeled figure. A `dt` and its `dd`, so a screen reader reads label then value, in order. */
function Figure({ label, extra, children }: { label: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <dt className="flex items-center gap-2 text-sm font-medium text-muted">
        {label}
        {extra}
      </dt>
      <dd className="mt-2 space-y-2">{children}</dd>
    </div>
  );
}

/** Why a figure has no value, with "Unavailable" spelled out. */
function UnavailableFigure({ reason }: { reason: string }) {
  return (
    <>
      <p className="text-xl font-semibold">
        <Unavailable />
      </p>
      <p className="text-xs leading-5 text-muted">{reason}</p>
    </>
  );
}

function sourcesUnavailable(sources: FigureSources, noun: string): string {
  return sources.unavailable.length === 0
    ? `No provider in this view reports ${noun}.`
    : `${formatList(sources.unavailable)} could not report ${noun} for this window.`;
}

/** "From Vercel. Unavailable from Stripe, not counted." */
function SourcesLine({ sources }: { sources: FigureSources }) {
  const parts = [`From ${formatList(sources.included)}.`];
  if (sources.unavailable.length > 0) parts.push(`Unavailable from ${formatList(sources.unavailable)}, not counted.`);
  return <p className="text-xs leading-5 text-muted">{parts.join(" ")}</p>;
}

/** The providers that could not report the previous window, as the reason for no comparison. */
function providersGap(names: readonly string[]): ComparisonGap | null {
  return names.length === 0 ? null : { reason: "providers", names };
}

function Value({
  value,
  format,
  windows,
  gap,
  estimated,
  currency,
}: {
  value: FigureValue;
  format: (value: number) => string;
  windows: HeadlineWindowLabel;
  gap: ComparisonGap | null;
  estimated?: boolean | undefined;
  currency?: string | undefined;
}) {
  return (
    <div>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xl font-semibold tabular-nums">{format(value.value)}</span>
        {currency === undefined ? null : <span className="font-mono text-xs text-muted">{currency}</span>}
        {estimated === undefined ? null : <ProvenanceBadge provenance={estimated ? ESTIMATED : VERIFIED} />}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted">{headlineComparisonText(value.comparison, format, windows, gap)}</p>
    </div>
  );
}

/** Each currency on its own line, verified and estimated side by side, never added together. */
function MoneyLines({ lines, gap, windows }: { lines: readonly MoneyLine[]; gap: ComparisonGap | null; windows: HeadlineWindowLabel }) {
  return (
    <ul className="space-y-3">
      {lines.map((line) => {
        const format = moneyFormatter(line.currency);
        return (
          <li key={line.currency} className="space-y-2">
            {line.verified === null ? null : (
              <Value value={line.verified} format={format} windows={windows} gap={gap} estimated={false} currency={line.currency} />
            )}
            {line.estimated === null ? null : (
              <Value value={line.estimated} format={format} windows={windows} gap={gap} estimated currency={line.currency} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MoneyFigureBody({ figure, windows, noun }: { figure: MoneyFigure; windows: HeadlineWindowLabel; noun: string }) {
  if (figure.lines === null) return <UnavailableFigure reason={sourcesUnavailable(figure, noun)} />;
  return (
    <>
      <MoneyLines lines={figure.lines} gap={providersGap(figure.previousUnavailable)} windows={windows} />
      <SourcesLine sources={figure} />
    </>
  );
}

function CountFigureBody({
  figure,
  windows,
  noun,
  singular,
  children,
}: {
  figure: CountFigure;
  windows: HeadlineWindowLabel;
  noun: string;
  singular: string;
  children?: ReactNode;
}) {
  if (figure.value === null) {
    return (
      <>
        <UnavailableFigure reason={sourcesUnavailable(figure, noun)} />
        {children}
      </>
    );
  }
  return (
    <>
      <Value
        value={figure.value}
        format={(value) => formatCount(value, singular, noun)}
        windows={windows}
        gap={providersGap(figure.previousUnavailable)}
      />
      {children}
      <SourcesLine sources={figure} />
    </>
  );
}

const COST_PER_SIGNUP_MISSING = {
  spend: "Needs spend for this window.",
  signups: "Needs signups for this window.",
  no_signups: "No signups in this window to share the spend over.",
} as const satisfies Record<NonNullable<CostPerSignupFigure["missing"]>, string>;

/** "Leaves out spend from Stripe, unavailable for this window." for each side that left one out. */
function LeftOut({ side, names }: { side: string; names: readonly string[] }) {
  if (names.length === 0) return null;
  return <p className="text-xs leading-5 text-muted">{`Leaves out ${side} from ${formatList(names)}, unavailable for this window.`}</p>;
}

function DeploysExtra({ figure }: { figure: DeploysFigure }) {
  if (figure.failed === null || figure.failed === 0) return null;
  return <p className="text-xs leading-5 text-muted">{`Including ${formatQuantity(figure.failed, "failed")}.`}</p>;
}

/** Why a source that reports whole UTC days leaves today out, shown whether or not it could report. */
function WholeDays({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return <p className="text-xs leading-5 text-muted">{wholeDaysNote(names)}</p>;
}

/** The six figures of one window. */
function Figures({ strip }: { strip: Strip }) {
  const { windows, net, costPerSignup } = strip;
  return (
    <>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Figure label="Revenue">
          <MoneyFigureBody figure={strip.revenue} windows={windows} noun="revenue" />
        </Figure>
        <Figure label="Spend">
          <MoneyFigureBody figure={strip.spend} windows={windows} noun="spend" />
        </Figure>
        <Figure label="Revenue minus spend">
          {net.lines === null ? (
            <UnavailableFigure reason="Needs both revenue and spend for this window." />
          ) : (
            <>
              <MoneyLines lines={net.lines} gap={providersGap(net.previousUnavailable)} windows={windows} />
              <LeftOut side="revenue" names={strip.revenue.unavailable} />
              <LeftOut side="spend" names={strip.spend.unavailable} />
            </>
          )}
        </Figure>
        <Figure label="Signups">
          <CountFigureBody figure={strip.signups} windows={windows} noun="signups" singular="signup">
            <WholeDays names={strip.signups.wholeDays} />
          </CountFigureBody>
        </Figure>
        <Figure
          label="Cost per signup"
          extra={<InfoTooltip label="How cost per signup is worked out" text={costPerSignupExplanation(costPerSignup)} />}
        >
          {costPerSignup.missing === null ? (
            <MoneyLines lines={costPerSignup.lines} gap={costPerSignup.comparisonGap} windows={windows} />
          ) : (
            <UnavailableFigure reason={COST_PER_SIGNUP_MISSING[costPerSignup.missing]} />
          )}
        </Figure>
        <Figure label="Deploys">
          <CountFigureBody figure={strip.deploys} windows={windows} noun="deploys" singular="deploy">
            <DeploysExtra figure={strip.deploys} />
          </CountFigureBody>
        </Figure>
      </dl>

      {strip.otherBillingPeriods.length > 0 ? (
        <p className="mt-3 max-w-3xl text-xs leading-5 text-muted">
          {`Worked out from daily readings for this window, not from billing periods. ${formatList(strip.otherBillingPeriods)} ${
            strip.otherBillingPeriods.length === 1 ? "bills" : "bill"
          } over a different period, so these figures will not match an invoice.`}
        </p>
      ) : null}
    </>
  );
}

/**
 * The window to date; or, when it has no figure, the last complete window, labeled with its dates
 * and why it is shown; or, when that has none either, one explanation instead of the figures (#267).
 * `markSimulated` is false when the page says "Simulated" once for everything on it (#269).
 */
export function HeadlineStrip({
  headline,
  hrefs,
  markSimulated,
}: {
  headline: HeadlineView;
  hrefs: Readonly<Record<HeadlineWindowKind, string>>;
  markSimulated: boolean;
}) {
  const titleId = useId();
  const windows = headline.status === "empty" ? headline.current : headline.strip.windows;
  return (
    <section aria-labelledby={titleId} className="mt-6 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {headlineTitle(windows)}
            </h2>
            {markSimulated && headline.status !== "empty" && headline.strip.simulated ? <SimulatedBadge /> : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{windowDescription(windows)}</p>
          {headline.status === "fallback" ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{headlineFallbackNote(headline.current)}</p>
          ) : null}
        </div>
        <nav aria-label="Headline window" className="flex flex-wrap gap-2">
          {HEADLINE_WINDOW_KINDS.map((option) => {
            const current = option === windows.kind;
            return (
              <Link
                key={option}
                href={hrefs[option]}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-md border px-4 py-2 text-sm transition-colors ${
                  current ? "border-accent font-medium text-foreground" : "border-line-strong text-muted hover:text-foreground"
                }`}
              >
                {headlineChoiceLabel(option)}
              </Link>
            );
          })}
        </nav>
      </div>

      {headline.status === "empty" ? (
        <p className="mt-3 max-w-3xl rounded-lg border border-line bg-panel p-4 text-sm leading-6 text-muted">
          {headlineEmptyNote(headline.current)}
        </p>
      ) : (
        <Figures strip={headline.strip} />
      )}
    </section>
  );
}
