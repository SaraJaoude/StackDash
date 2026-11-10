import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/page-skeleton";
import { ShareDialog } from "@/components/public-metrics/share-dialog";
import { loadYearSummary } from "@/lib/data/year-summary";
import { CARD_SIZE, shareToXUrl } from "@/lib/public-metrics/share";
import {
  isYearComplete,
  latestCardYear,
  parseCardYear,
  yearCardAltText,
  yearFigureNote,
  yearFigures,
  yearLabel,
  yearPeriod,
  yearProvenance,
  yearShareText,
  yearToDateNote,
} from "@/lib/public-metrics/yearly";
import { requireWorkspace } from "@/lib/workspaces/access";
import { yearInReviewPath } from "@/lib/workspaces/paths";

export const metadata: Metadata = { title: "Year in review" };

/*
 * The yearly stack summary (#151): a card of what the workspace did in a calendar year, for its
 * members only. A past year shows in full; the current year shows at any time as the year to date,
 * labeled "2026 so far" (decision on issue #151). Sharing is the same dialog as the milestone cards
 * (#149), with Download in place of a public URL, because this card has none: it is public only
 * once a member posts it.
 */

// Every section renders inside its own Suspense boundary so navigating between sections
// has an instant shell; access checks and data reads stream in behind it.
export default function YearInReviewPage(props: PageProps<"/w/[workspace]/year/[year]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <YearInReviewContent {...props} />
    </Suspense>
  );
}

async function YearInReviewContent({ params }: PageProps<"/w/[workspace]/year/[year]">) {
  const { workspace: slug, year: yearParam } = await params;
  const { workspace } = await requireWorkspace(slug, "viewer");
  // Read after the request data above, so the clock never runs during prerendering.
  const now = new Date();
  const year = parseCardYear(yearParam, now);
  if (year === null) notFound();
  const complete = isYearComplete(year, now);

  return (
    <>
      <PageHeader
        title={`Your stack in ${yearLabel(year, now)}`}
        description={`What your connected providers did ${complete ? `in ${year}` : "this year up to today"}, counted from the data DevMacro stored. Only members of this workspace can see it.`}
      />
      <nav aria-label="Years" className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link href={yearInReviewPath(workspace.slug, year - 1)} className="text-muted underline underline-offset-4 hover:text-foreground">
          {year - 1}
        </Link>
        {year + 1 <= latestCardYear(now) ? (
          <Link href={yearInReviewPath(workspace.slug, year + 1)} className="text-muted underline underline-offset-4 hover:text-foreground">
            {year + 1}
          </Link>
        ) : null}
      </nav>
      <YearCardSection workspaceId={workspace.id} slug={workspace.slug} year={year} now={now} />
    </>
  );
}

async function YearCardSection({ workspaceId, slug, year, now }: { workspaceId: string; slug: string; year: number; now: Date }) {
  const summary = await loadYearSummary(workspaceId, year, now);
  const complete = isYearComplete(year, now);
  const cardName = complete ? `${year} card` : `${year} year to date card`;
  const cardSrc = `${yearInReviewPath(slug, year)}/card.png`;
  const alt = yearCardAltText(summary);
  return (
    <section aria-labelledby="year-card-title" className="mt-6 space-y-6 rounded-xl border border-line bg-panel px-6 py-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="year-card-title" className="font-semibold">
            {complete ? yearPeriod(summary) : `Year to date: ${yearPeriod(summary)}`}
          </h2>
          {complete ? null : <p className="mt-1 text-muted">{yearToDateNote(year)}</p>}
        </div>
        <ShareDialog
          title={`Share your ${cardName}`}
          triggerText="Share"
          subject={`your ${cardName}`}
          card={{ src: cardSrc, alt, ...CARD_SIZE, downloadName: complete ? `devmacro-${year}.png` : `devmacro-${year}-so-far.png` }}
          xIntentUrl={shareToXUrl(yearShareText(summary))}
          notes={[
            "This card is private to your workspace. It becomes public only when you post it.",
            "Download the card, then attach it to your post with the alt text.",
          ]}
        />
      </div>
      {/* Unoptimized: the card is rendered for this member at its final size and must not be cached. The
          figures are listed in full below it, so its alt text points there instead of repeating them. */}
      <Image
        src={cardSrc}
        alt={`Your ${cardName}. Its figures are listed below.`}
        {...CARD_SIZE}
        unoptimized
        className="h-auto w-full max-w-3xl rounded-lg border border-line"
      />
      <dl className="grid gap-4 sm:grid-cols-2">
        {yearFigures(summary).map((figure) => {
          const note = yearFigureNote(figure);
          return (
            <div key={figure.label}>
              <dt className="text-muted">{figure.label}</dt>
              <dd className="mt-1 text-lg font-semibold">
                {figure.value}
                {note === null ? null : <span className="ml-2 text-sm font-normal text-muted">{note}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-muted">{yearProvenance(summary)}. No spend, no account names, and no repository names.</p>
    </section>
  );
}
