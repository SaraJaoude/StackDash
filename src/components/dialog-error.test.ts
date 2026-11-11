import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DialogError, type DialogFailure } from "./dialog-error";

const REGION = '<div role="alert" aria-live="assertive" class="text-sm">';

function render(failure: DialogFailure | null | undefined): string {
  return renderToStaticMarkup(createElement(DialogError, { failure }));
}

describe("DialogError", () => {
  // The region must exist before the failure does: a live region added together with its text is
  // not announced by every screen reader.
  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("renders the empty live region when there is no failure (%s)", (_label, failure) => {
    expect(render(failure)).toBe(`${REGION}</div>`);
  });

  it("renders the message inside the region, focusable from script only, without a reference", () => {
    const markup = render({ message: "This project no longer exists. Reload the page to see the current list." });
    expect(markup.startsWith(REGION)).toBe(true);
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("This project no longer exists. Reload the page to see the current list.");
    expect(markup).not.toContain("Reference");
  });

  it("adds the reference id after the message for an unexpected failure", () => {
    const markup = render({
      message: "The connection could not be disconnected. Try again in a moment.",
      referenceId: "ref_123",
    });
    expect(markup).toContain(
      'Try again in a moment. Reference <code class="font-mono text-xs text-foreground">ref_123</code>.',
    );
  });
});
