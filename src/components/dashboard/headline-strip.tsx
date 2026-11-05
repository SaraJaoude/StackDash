import Link from "next/link";
import { useId, type ReactNode } from "react";

import { SimulatedBadge } from "@/components/connections/simulated-badge";
import {
  costPerSignupExplanation,
  formatCount,
  HEADLINE_WINDOW_KINDS,
  headlineChoiceLabel,
  headlineComparisonText,
  headlineTitle,
  listNames,
  moneyFormatter,
  windowDescription,
  type CostPerSignupFigure,
  type CountFigure,
  type DeploysFigure,
  type FigureSources,
  type FigureValue,
  type HeadlineStrip as Strip,
  type HeadlineWindowKind,
  type MoneyFigure,
} from "@/lib/dashboard/headline";
import { formatQuantity } from "@/lib/format";

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
    ? `No connected provider reports ${noun}.`
    : `${listNames(sources.unavailable)} could not report ${noun} for this window.`;
}

/** "From Vercel. Unavailable from Supabase, not counted." */
function SourcesLine({ sources }: { sources: FigureSources }) {
  const parts = [`From ${listNames(sources.included)}.`];
  if (sources.unavailable.length > 0) parts.push(`Unavailable from ${listNames(sources.unavailable)}, not counted.`);
  return <p className="text-xs leading-5 text-muted">{parts.join(" ")}</p>;
}

function Value({
  value,
  format,
  kind,
  previousUnavailable,
  estimated,
  currency,
}: {
  value: FigureValue;
  format: (value: number) => string;
  kind: HeadlineWindowKind;
  previousUnavailable: readonly string[];
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
      <p className="mt-1 text-xs leading-5 text-muted">
        {headlineComparisonText(value.comparison, format, kind, previousUnavailable)}
      </p>
    </div>
  );
}

/** Each currency on its own line, verified and estimated side by side, never added together. */
function MoneyLines({ figure, kind }: { figure: MoneyFigure | CostPerSignupFigure; kind: HeadlineWindowKind }) {
  const previousUnavailable = "previousUnavailable" in figure ? figure.previousUnavailable : [];
  return (
    <ul className="space-y-3">
      {(figure.lines ?? []).map((line) => {
        const format = moneyFormatter(line.currency);
        return (
          <li key={line.currency} className="space-y-2">
            {line.verified === null ? null : (
              <Value value={line.verified} format={format} kind={kind} previousUnavailable={previousUnavailable} estimated={false} currency={line.currency} />
            )}
            {line.estimated === null ? null : (
              <Value value={line.estimated} format={format} kind={kind} previousUnavailable={previousUnavailable} estimated currency={line.currency} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MoneyFigureBody({ figure, kind, noun }: { figure: MoneyFigure; kind: HeadlineWindowKind; noun: string }) {
  if (figure.lines === null) return <UnavailableFigure reason={sourcesUnavailable(figure, noun)} />;
  return (
    <>
      <MoneyLines figure={figure} kind={kind} />
      <SourcesLine sources={figure} />
    </>
  );
}

function CountFigureBody({
  figure,
  kind,
  noun,
  singular,
  children,
}: {
  figure: CountFigure;
  kind: HeadlineWindowKind;
  noun: string;
  singular: string;
  children?: ReactNode;
}) {
  if (figure.value === null) return <UnavailableFigure reason={sourcesUnavailable(figure, noun)} />;
  return (
    <>
      <Value
        value={figure.value}
        format={(value) => formatCount(value, singular, noun)}
        kind={kind}
        previousUnavailable={figure.previousUnavailable}
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

function DeploysExtra({ figure }: { figure: DeploysFigure }) {
  if (figure.failed === null || figure.failed === 0) return null;
  return <p className="text-xs leading-5 text-muted">{`Including ${formatQuantity(figure.failed, "failed")}.`}</p>;
}

export function HeadlineStrip({ strip, hrefs }: { strip: Strip; hrefs: Readonly<Record<HeadlineWindowKind, string>> }) {
  const titleId = useId();
  const { kind } = strip.windows;
  const net = strip.net;
  return (
    <section aria-labelledby={titleId} className="mt-6 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {headlineTitle(kind)}
            </h2>
            {strip.simulated ? <SimulatedBadge /> : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{windowDescription(strip.windows)}</p>
        </div>
        <nav aria-label="Headline window" className="flex flex-wrap gap-2">
          {HEADLINE_WINDOW_KINDS.map((option) => {
            const current = option === kind;
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

      <dl className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Figure label="Revenue">
          <MoneyFigureBody figure={strip.revenue} kind={kind} noun="revenue" />
        </Figure>
        <Figure label="Spend">
          <MoneyFigureBody figure={strip.spend} kind={kind} noun="spend" />
        </Figure>
        <Figure label="Revenue minus spend">
          {net.lines === null ? (
            <UnavailableFigure reason="Needs both revenue and spend for this window." />
          ) : (
            <>
              <MoneyLines figure={net} kind={kind} />
              {net.unavailable.length > 0 ? (
                <p className="text-xs leading-5 text-muted">{`Leaves out ${listNames(net.unavailable)}, unavailable for this window.`}</p>
              ) : null}
            </>
          )}
        </Figure>
        <Figure label="Signups">
          <CountFigureBody figure={strip.signups} kind={kind} noun="signups" singular="signup" />
        </Figure>
        <Figure
          label="Cost per signup"
          extra={<InfoTooltip label="How cost per signup is worked out" text={costPerSignupExplanation(strip.costPerSignup)} />}
        >
          {strip.costPerSignup.missing === null ? (
            <MoneyLines figure={strip.costPerSignup} kind={kind} />
          ) : (
            <UnavailableFigure reason={COST_PER_SIGNUP_MISSING[strip.costPerSignup.missing]} />
          )}
        </Figure>
        <Figure label="Deploys">
          <CountFigureBody figure={strip.deploys} kind={kind} noun="deploys" singular="deploy">
            <DeploysExtra figure={strip.deploys} />
          </CountFigureBody>
        </Figure>
      </dl>

      {strip.otherBillingPeriods.length > 0 ? (
        <p className="mt-3 max-w-3xl text-xs leading-5 text-muted">
          {`Worked out from daily readings for this window, not from billing periods. ${listNames(strip.otherBillingPeriods)} ${
            strip.otherBillingPeriods.length === 1 ? "bills" : "bill"
          } over a different period, so these figures will not match an invoice.`}
        </p>
      ) : null}
    </section>
  );
}
