"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";

import { inputClass, smallButtonClass } from "@/components/alerts/form-controls";

/*
 * The share dialog for milestone cards and badges (#149) and the yearly card (#151). Everything in
 * it is user-initiated: copying text, downloading the card, and "Share to X", which opens X's
 * prefilled post in a new tab for the person to edit and send. Nothing is posted automatically.
 *
 * A native modal `<dialog>` like the other confirmations in the app: focus moves into it on open,
 * Escape or Close closes it, and focus returns to the button that opened it. Its content mounts on
 * first open only, so the page never loads the badge or card images (or counts them as served)
 * until someone asks to share.
 */

export type ShareDialogProps = Readonly<{
  /** The dialog's heading, for example "Share GitHub stars". */
  title: string;
  /** Visible trigger text; the accessible name adds `subject`. */
  triggerText: string;
  subject: string;
  card: Readonly<{
    src: string;
    alt: string;
    width: number;
    height: number;
    /** Anyone may open it: offer "Copy card URL". */
    publicUrl?: string;
    /** Members only: offer "Download card" with this file name instead. */
    downloadName?: string;
  }>;
  badge?: Readonly<{ src: string; alt: string; markdown: string }>;
  xIntentUrl: string;
  /** Extra lines under the heading: who can see this, how often it was served. */
  notes: readonly string[];
}>;

type CopyTarget = "badge Markdown" | "card URL" | "alt text";

export function ShareDialog({ title, triggerText, subject, card, badge, xIntentUrl, notes }: ShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState("");
  const titleId = useId();
  const baseId = useId();

  async function copy(text: string, target: CopyTarget) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied the ${target}.`);
    } catch {
      // The clipboard needs permission and a secure context; the text stays selectable instead.
      setStatus(`Could not copy the ${target}. Select the text in its field and copy it yourself.`);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpened(true);
          setStatus("");
          dialogRef.current?.showModal();
        }}
        className={smallButtonClass}
      >
        {triggerText}
        <span className="sr-only"> {subject}</span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => triggerRef.current?.focus()}
        className="m-auto max-h-[calc(100%-2rem)] w-[min(40rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-panel p-6 text-foreground backdrop:bg-black/60"
      >
        {opened ? (
          <div className="space-y-6 text-sm">
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              <button type="button" autoFocus onClick={() => dialogRef.current?.close()} className={smallButtonClass}>
                Close
              </button>
            </div>
            {notes.length === 0 ? null : (
              <div className="space-y-1 leading-6 text-muted">
                {notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            )}

            {badge === undefined ? null : (
              <section aria-labelledby={`${baseId}-badge`} className="space-y-3">
                <h3 id={`${baseId}-badge`} className="font-semibold">
                  Badge
                </h3>
                {/* Unoptimized: the badge is a live SVG; the optimizer would cache and rasterize it. */}
                <Image src={badge.src} alt={badge.alt} width={160} height={20} unoptimized className="h-5 w-auto" />
                <label htmlFor={`${baseId}-markdown`} className="block font-medium">
                  Badge Markdown for a README
                </label>
                <textarea
                  id={`${baseId}-markdown`}
                  readOnly
                  rows={2}
                  value={badge.markdown}
                  className={`${inputClass} border-line-strong font-mono text-xs`}
                />
                <button type="button" onClick={() => copy(badge.markdown, "badge Markdown")} className={smallButtonClass}>
                  Copy badge Markdown
                </button>
              </section>
            )}

            <section aria-labelledby={`${baseId}-card`} className="space-y-3">
              <h3 id={`${baseId}-card`} className="font-semibold">
                Card
              </h3>
              {/* Unoptimized: the card is rendered live at its final size already. */}
              <Image
                src={card.src}
                alt={card.alt}
                width={card.width}
                height={card.height}
                unoptimized
                className="h-auto w-full rounded-lg border border-line"
              />
              {card.publicUrl === undefined ? null : (
                <>
                  <label htmlFor={`${baseId}-url`} className="block font-medium">
                    Card URL
                  </label>
                  <input id={`${baseId}-url`} readOnly value={card.publicUrl} className={`${inputClass} border-line-strong`} />
                  <button type="button" onClick={() => copy(card.publicUrl ?? "", "card URL")} className={smallButtonClass}>
                    Copy card URL
                  </button>
                </>
              )}
              <label htmlFor={`${baseId}-alt`} className="block font-medium">
                Alt text for the card
              </label>
              <textarea
                id={`${baseId}-alt`}
                readOnly
                rows={3}
                value={card.alt}
                className={`${inputClass} border-line-strong`}
              />
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => copy(card.alt, "alt text")} className={smallButtonClass}>
                  Copy alt text
                </button>
                {card.downloadName === undefined ? null : (
                  <a href={card.src} download={card.downloadName} className={smallButtonClass}>
                    Download card
                  </a>
                )}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <a href={xIntentUrl} target="_blank" rel="noopener noreferrer" className={smallButtonClass}>
                Share to X<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <p role="status" aria-live="polite" className="text-muted">
                {status}
              </p>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
