import type { ReactNode } from "react";

interface SectionProps {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}

/** Shared section shell: consistent rhythm, anchor targets, and heading semantics. */
export function Section({ id, eyebrow, title, intro, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">{eyebrow}</p>
        <h2 id={`${id}-title`} className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h2>
        {intro ? <p className="mt-4 max-w-2xl text-base leading-7 text-muted">{intro}</p> : null}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}
