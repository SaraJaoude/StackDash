import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PaletteCommand } from "@/lib/palette/search";

import { CommandPalette } from "./command-palette";

// The palette only pushes when a result is chosen, which a server render never reaches.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const COMMANDS: readonly PaletteCommand[] = [
  { id: "page:timeline", label: "Go to timeline", keywords: "", action: { kind: "navigate", href: "/w/acme/timeline" } },
];

/** The server-rendered markup, and the opening tag of the palette's dialog (the first `<dialog>`). */
function render(notice: string | null): Readonly<{ markup: string; dialog: string }> {
  const markup = renderToStaticMarkup(createElement(CommandPalette, { commands: COMMANDS, notice }));
  const dialog = /<dialog\b[^>]*>/.exec(markup)?.[0];
  if (dialog === undefined) throw new Error("The palette rendered no dialog.");
  return { markup, dialog };
}

describe("CommandPalette notice", () => {
  it("describes the dialog with the notice, so a screen reader reads it on open", () => {
    const notice = "Providers, projects, and accounts could not be loaded, so only pages are listed.";
    const { markup, dialog } = render(notice);
    const describedBy = /aria-describedby="([^"]+)"/.exec(dialog)?.[1];
    if (describedBy === undefined) throw new Error("The dialog has no aria-describedby.");
    expect(markup).toMatch(new RegExp(`<p id="${describedBy}"[^>]*>${notice}</p>`));
  });

  it("has no description when everything loaded", () => {
    const { markup, dialog } = render(null);
    expect(dialog).not.toContain("aria-describedby");
    expect(markup).not.toContain("could not be loaded");
  });
});
