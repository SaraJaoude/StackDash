import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * Status and error announcements (#342). The house rule is `polite` for status and `assertive`
 * for errors, so the tone picks both the role and the politeness and no caller sets either.
 *
 * Keep a region mounted while its text comes and goes: a region inserted together with its text
 * is not announced by every screen reader.
 */
export type LiveTone = "status" | "error";

type LiveRegionProps = Omit<HTMLAttributes<HTMLElement>, "role" | "aria-live"> & {
  tone: LiveTone;
  /** The element to render; `span` inside a line of text or an inline row. */
  as?: "div" | "p" | "span";
  ref?: Ref<HTMLElement>;
};

export function LiveRegion({ tone, as = "div", ...props }: LiveRegionProps) {
  return createElement(as, {
    role: tone === "error" ? "alert" : "status",
    "aria-live": tone === "error" ? "assertive" : "polite",
    ...props,
  });
}

/** " Reference abc123." after a message, for a failure the server logged under that id. */
export function ReferenceNote({ referenceId }: { referenceId: string | undefined }) {
  if (referenceId === undefined) return null;
  return (
    <>
      {" "}
      Reference <code className="font-mono text-xs text-foreground">{referenceId}</code>.
    </>
  );
}

/** How an action is going or how it ended, as one sentence for its announcement. */
export type Outcome = Readonly<{
  /** `info` for progress and neutral results, in muted text. */
  tone: "info" | "success" | "error";
  message: ReactNode;
  referenceId?: string | undefined;
}>;

type SettledResult = Readonly<{ ok: true } | { ok: false; message: string; referenceId?: string | undefined }>;

/**
 * The outcome of a server action's result: its failure, or `success` when it worked. Null before
 * the first result, and for a success with nothing to say. Pass null while the action runs, so the
 * previous result is cleared and the next one is announced as a change.
 */
export function outcomeOf(result: SettledResult | null, success: ReactNode): Outcome | null {
  if (result === null) return null;
  if (!result.ok) return { tone: "error", message: result.message, referenceId: result.referenceId };
  return success === undefined || success === null ? null : { tone: "success", message: success };
}

const OUTCOME_COLORS: Record<Outcome["tone"], string> = {
  info: "text-muted",
  success: "text-success",
  error: "text-danger",
};

function OutcomeMessage({ outcome, inline, className }: { outcome: Outcome; inline: boolean; className: string }) {
  return createElement(
    inline ? "span" : "p",
    { className: `${OUTCOME_COLORS[outcome.tone]} ${className}`.trim() },
    outcome.message,
    <ReferenceNote referenceId={outcome.referenceId} />,
  );
}

type AnnouncementLayout = {
  className?: string;
  /** Spacing for the message itself, such as `mt-2`; the tone sets its color. */
  messageClassName?: string;
  /** Spans instead of blocks, for a row of inline content. */
  inline?: boolean;
};

/**
 * The result of an action that can succeed or fail: progress and success in the polite region, a
 * failure in the assertive one. Both regions are always mounted, inside one wrapper, so the pair
 * takes one place in a flex or grid layout.
 */
export function OutcomeAnnouncement({
  outcome,
  className,
  messageClassName = "",
  inline = false,
}: AnnouncementLayout & { outcome: Outcome | null }) {
  const tag = inline ? "span" : "div";
  return createElement(
    tag,
    { className },
    <LiveRegion tone="status" as={tag}>
      {outcome === null || outcome.tone === "error" ? null : (
        <OutcomeMessage outcome={outcome} inline={inline} className={messageClassName} />
      )}
    </LiveRegion>,
    <LiveRegion tone="error" as={tag}>
      {outcome?.tone === "error" ? <OutcomeMessage outcome={outcome} inline={inline} className={messageClassName} /> : null}
    </LiveRegion>,
  );
}

/** The failure of an action whose success is announced elsewhere, or not at all. */
export function FailureAnnouncement({
  failure,
  className,
  messageClassName = "",
  inline = false,
}: AnnouncementLayout & { failure: Readonly<{ message: string; referenceId?: string | undefined }> | null }) {
  return (
    <LiveRegion tone="error" as={inline ? "span" : "div"} className={className}>
      {failure === null ? null : (
        <OutcomeMessage
          outcome={{ tone: "error", message: failure.message, referenceId: failure.referenceId }}
          inline={inline}
          className={messageClassName}
        />
      )}
    </LiveRegion>
  );
}
