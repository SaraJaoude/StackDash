"use client";

import { useId, useState } from "react";

import { smallButtonClass } from "@/components/alerts/form-controls";
import { ShareDialog } from "@/components/public-metrics/share-dialog";
import { yearFigureNote, type YearSlide } from "@/lib/public-metrics/yearly";

/*
 * The year in review's slides (#262): one figure at a time, with Previous slide and Next slide
 * buttons, a download link for the slide's image, and the share dialog of the yearly card (#151)
 * for that slide. The slides are rendered on the server and passed in whole, so moving between
 * them reads nothing.
 *
 * Keyboard: the buttons are real buttons in reading order. At the first and last slide the button
 * that cannot move stays focusable and says so with aria-disabled, so focus is never lost to the
 * page. Each move is announced politely as "Slide 2 of 4: Longest run of successful deployments";
 * the first render announces nothing. The slide's entrance animation is off under
 * prefers-reduced-motion (`.slide-enter` in globals.css).
 */

export type YearSlideView = Readonly<{
  slide: YearSlide;
  /** The slide's PNG, its alt text, and the file name a download saves it as. */
  image: Readonly<{ src: string; alt: string; downloadName: string }>;
  xIntentUrl: string;
}>;

type YearSlidesProps = Readonly<{
  slides: readonly YearSlideView[];
  /** "2026 year to date" or "2025", for the share dialog's heading. */
  yearName: string;
  width: number;
  height: number;
}>;

const SHARE_NOTES = [
  "This slide is private to your workspace. It becomes public only when you post it.",
  "Download the slide, then attach it to your post with the alt text.",
] as const;

export function YearSlides({ slides, yearName, width, height }: YearSlidesProps) {
  const [index, setIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const titleId = useId();
  const current = slides[index];
  if (current === undefined) return null;
  const { slide, image } = current;
  const total = slides.length;

  function moveTo(next: number) {
    const target = slides[next];
    if (target === undefined) return;
    setIndex(next);
    setAnnouncement(`Slide ${next + 1} of ${total}: ${target.slide.title}`);
  }

  const atStart = index === 0;
  const atEnd = index === total - 1;
  const slideName = `${yearName} ${slide.title.toLowerCase()} slide`;

  return (
    <div className="space-y-4">
      <div
        key={slide.id}
        role="group"
        aria-labelledby={titleId}
        className="slide-enter flex min-h-64 flex-col justify-center rounded-lg border border-line bg-background px-6 py-6"
      >
        <p className="text-sm text-muted">
          Slide {index + 1} of {total}
        </p>
        <h3 id={titleId} className="mt-2 text-base font-semibold">
          {slide.title}
        </h3>
        {slide.id === "totals" ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {slide.figures.map((figure) => {
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
        ) : (
          <>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{slide.value}</p>
            <p className="mt-3 text-muted">{slide.detail}</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* moveTo ignores a move past either end, where the button is aria-disabled. */}
        <button type="button" aria-disabled={atStart} onClick={() => moveTo(index - 1)} className={smallButtonClass}>
          Previous slide
        </button>
        <button type="button" aria-disabled={atEnd} onClick={() => moveTo(index + 1)} className={smallButtonClass}>
          Next slide
        </button>
        <a href={image.src} download={image.downloadName} className={smallButtonClass}>
          Download slide
          <span className="sr-only">: {slide.title}</span>
        </a>
        <ShareDialog
          key={slide.id}
          title={`Share your ${slideName}`}
          triggerText="Share"
          subject={`your ${slideName}`}
          card={{ src: image.src, alt: image.alt, width, height, downloadName: image.downloadName }}
          xIntentUrl={current.xIntentUrl}
          notes={SHARE_NOTES}
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
