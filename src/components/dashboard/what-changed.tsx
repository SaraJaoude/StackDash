import Link from "next/link";
import { useId } from "react";

import type { WhatChanged as Summary } from "@/lib/dashboard/what-changed";

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

/**
 * The dashboard's opening summary (#270): up to three sentences on what was unusual, each with a
 * link to that provider's day on the timeline. Nothing at all when nothing was unusual, so a quiet
 * week never pushes the numbers down. Words and links only; no color carries meaning.
 */
export function WhatChanged({ summary, days }: { summary: Summary; days: number }) {
  const titleId = useId();
  const { sentences, total } = summary;
  if (sentences.length === 0) return null;
  const window = `in the last ${COUNT_FORMAT.format(days)} days, newest first`;
  const description =
    total > sentences.length
      ? `${COUNT_FORMAT.format(sentences.length)} of ${COUNT_FORMAT.format(total)} unusual changes in spend and usage ${window}.`
      : `Unusual spend and usage ${window}.`;
  return (
    <section aria-labelledby={titleId} className="mt-6 rounded-xl border border-line bg-panel px-5 py-4 text-sm">
      <h2 id={titleId} className="font-semibold">
        What changed
      </h2>
      <p className="mt-1 leading-6 text-muted">{description}</p>
      <ul className="mt-3 space-y-3">
        {sentences.map((sentence) => (
          <li key={sentence.key}>
            <p className="max-w-4xl leading-6">{sentence.text}</p>
            <Link href={sentence.href} className="inline-flex min-h-6 items-center text-accent underline underline-offset-2">
              {sentence.linkText}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
