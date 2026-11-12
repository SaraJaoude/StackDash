import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FailureAnnouncement,
  LiveRegion,
  OutcomeAnnouncement,
  outcomeOf,
  type Outcome,
} from "./live-region";

const STATUS = /<(div|span) role="status" aria-live="polite">(.*?)<\/\1>/;
const ALERT = /<(div|span) role="alert" aria-live="assertive">(.*?)<\/\1>/;

/** The classes on the message an announcement rendered. */
function classesOf(message: string): string[] {
  return (/^<(?:p|span) class="([^"]*)"/.exec(message)?.[1] ?? "").split(" ");
}

function announce(
  outcome: Outcome | null,
  inline = false,
): Readonly<{ status: string; alert: string }> {
  const markup = renderToStaticMarkup(
    createElement(OutcomeAnnouncement, { outcome, inline }),
  );
  return {
    status: STATUS.exec(markup)?.[2] ?? "missing",
    alert: ALERT.exec(markup)?.[2] ?? "missing",
  };
}

describe("LiveRegion", () => {
  it.each([
    ["status", "status", "polite"],
    ["error", "alert", "assertive"],
  ] as const)(
    "a %s region is role %s and %s, whatever element it renders",
    (tone, role, live) => {
      for (const as of ["div", "p", "span"] as const) {
        const markup = renderToStaticMarkup(
          createElement(
            LiveRegion,
            { tone, as, className: "text-sm" },
            "Saved.",
          ),
        );
        expect(markup).toBe(
          `<${as} role="${role}" aria-live="${live}" class="text-sm">Saved.</${as}>`,
        );
      }
    },
  );
});

describe("OutcomeAnnouncement", () => {
  it("keeps both regions mounted and empty before there is an outcome", () => {
    expect(announce(null)).toEqual({ status: "", alert: "" });
  });

  it.each(["info", "success"] as const)(
    "announces a %s outcome politely and leaves the alert empty",
    (tone) => {
      const { status, alert } = announce({ tone, message: "Key copied." });
      expect(status).toMatch(/^<p[^>]*>Key copied\.<\/p>$/);
      expect(alert).toBe("");
    },
  );

  it.each([
    ["info", "text-muted"],
    ["success", "text-success"],
    ["error", "text-danger"],
  ] as const)(
    "colors a %s message %s, so each tone reads differently",
    (tone, color) => {
      const { status, alert } = announce({ tone, message: "Key copied." });
      expect(classesOf(tone === "error" ? alert : status)).toContain(color);
    },
  );

  it("announces a failure assertively, with its reference, and leaves the status empty", () => {
    const { status, alert } = announce({
      tone: "error",
      message: "The name was not saved.",
      referenceId: "REF-1",
    });
    expect(status).toBe("");
    expect(alert).toMatch(
      /^<p[^>]*>The name was not saved\. Reference <code[^>]*>REF-1<\/code>\.<\/p>$/,
    );
  });

  it("renders spans inside a line of text", () => {
    const markup = renderToStaticMarkup(
      createElement(OutcomeAnnouncement, {
        outcome: { tone: "success", message: "Alert rule paused." },
        inline: true,
      }),
    );
    expect(markup).toMatch(
      /^<span><span role="status" aria-live="polite"><span[^>]*>Alert rule paused\.<\/span><\/span><span role="alert" aria-live="assertive"><\/span><\/span>$/,
    );
  });
});

describe("FailureAnnouncement", () => {
  it("renders only the assertive region, empty until there is a failure", () => {
    expect(
      renderToStaticMarkup(
        createElement(FailureAnnouncement, { failure: null }),
      ),
    ).toBe('<div role="alert" aria-live="assertive"></div>');
  });

  it("puts the failure and its reference in the assertive region", () => {
    const markup = renderToStaticMarkup(
      createElement(FailureAnnouncement, {
        failure: {
          message: "The alert was not acknowledged.",
          referenceId: "REF-2",
        },
      }),
    );
    expect(markup).not.toContain('role="status"');
    expect(markup).toMatch(
      /^<div role="alert" aria-live="assertive"><p[^>]*>The alert was not acknowledged\. Reference <code[^>]*>REF-2<\/code>\.<\/p><\/div>$/,
    );
  });
});

describe("outcomeOf", () => {
  it("is null before the first result and for a success with nothing to say", () => {
    expect(outcomeOf(null, "Saved.")).toBeNull();
    expect(outcomeOf({ ok: true }, null)).toBeNull();
    expect(outcomeOf({ ok: true }, undefined)).toBeNull();
  });

  it("words a success with the caller's message", () => {
    expect(outcomeOf({ ok: true }, "Workspace renamed.")).toEqual({
      tone: "success",
      message: "Workspace renamed.",
    });
  });

  it("turns a failure into an error with its reference, ignoring the success message", () => {
    expect(
      outcomeOf(
        { ok: false, message: "The name was not saved.", referenceId: "REF-3" },
        "Workspace renamed.",
      ),
    ).toEqual({
      tone: "error",
      message: "The name was not saved.",
      referenceId: "REF-3",
    });
    expect(
      outcomeOf({ ok: false, message: "The name was not saved." }, null),
    ).toEqual({
      tone: "error",
      message: "The name was not saved.",
      referenceId: undefined,
    });
  });
});
