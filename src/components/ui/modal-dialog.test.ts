import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DialogCloseButton, ModalDialog, useModalDialog } from "./modal-dialog";

type Props = Omit<Parameters<typeof ModalDialog>[0], "dialog" | "children">;

/** A closed dialog as the server renders it, with `children` as its content. */
function render(props: Props, children: ReactNode = createElement("p", null, "Body")): string {
  function Harness() {
    return createElement(ModalDialog, { ...props, dialog: useModalDialog() }, children);
  }
  return renderToStaticMarkup(createElement(Harness));
}

function attribute(markup: string, name: string): string | undefined {
  const dialog = /<dialog\b[^>]*>/.exec(markup)?.[0] ?? "";
  return new RegExp(`${name}="([^"]+)"`).exec(dialog)?.[1];
}

describe("ModalDialog", () => {
  it("is labelled by its title and described by its description", () => {
    const markup = render({ title: "Delete Billing?", description: "This cannot be undone." });
    const labelledBy = attribute(markup, "aria-labelledby");
    const describedBy = attribute(markup, "aria-describedby");
    expect(markup).toContain(`<h2 id="${labelledBy}" class="text-lg font-semibold tracking-tight break-words">Delete Billing?</h2>`);
    expect(markup).toContain(`<div id="${describedBy}" class="mt-3 text-sm leading-6 text-muted">This cannot be undone.</div>`);
  });

  it("is described by an element inside its content when there is no description under the title", () => {
    const markup = render({ title: "Command palette", hideTitle: true, describedBy: "notice", content: "always" });
    expect(attribute(markup, "aria-describedby")).toBe("notice");
    expect(markup).toMatch(/<h2 id="[^"]+" class="sr-only">Command palette<\/h2>/);
  });

  it("has no description when it is given none", () => {
    expect(attribute(render({ title: "Share GitHub stars" }), "aria-describedby")).toBeUndefined();
  });

  it.each([
    ["each-open", false],
    ["after-first-open", false],
    ["always", true],
  ] as const)("with %s content, renders the content before the first open: %s", (content, rendered) => {
    expect(render({ title: "Title", content }).includes("<p>Body</p>")).toBe(rendered);
  });

  it("marks Cancel to take focus on open, and a Close beside a search box not to", () => {
    const cancel = render({ title: "Title", content: "always" }, createElement(DialogCloseButton));
    expect(cancel).toMatch(/<button type="button" data-initial-focus=""[^>]*>Cancel<\/button>/);
    const close = render({ title: "Title", content: "always" }, createElement(DialogCloseButton, { initialFocus: false }, "Close"));
    expect(close).not.toContain("data-initial-focus");
  });

  it("refuses a close button outside a dialog", () => {
    expect(() => renderToStaticMarkup(createElement(DialogCloseButton))).toThrow(/inside ModalDialog/);
  });
});
