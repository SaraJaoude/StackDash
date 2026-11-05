import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GuardedButton, guardClick } from "./guarded-button";

function fakeClick() {
  return { preventDefault: vi.fn() };
}

describe("guardClick", () => {
  it("passes the click on while the button is available", () => {
    const event = fakeClick();
    const onClick = vi.fn();
    guardClick(false, event, onClick);
    expect(onClick).toHaveBeenCalledWith(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("lets an available submit button with no handler submit", () => {
    const event = fakeClick();
    guardClick(false, event, undefined);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("cancels the click and skips the handler while unavailable, so a pending form cannot submit twice", () => {
    const event = fakeClick();
    const onClick = vi.fn();
    guardClick(true, event, onClick);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("cancels the click while unavailable even without a handler", () => {
    const event = fakeClick();
    guardClick(true, event, undefined);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe("GuardedButton", () => {
  it("renders a plain button while available", () => {
    const html = renderToStaticMarkup(createElement(GuardedButton, { type: "submit", unavailable: false }, "Save name"));
    expect(html).toBe('<button type="submit">Save name</button>');
  });

  it("marks itself aria-disabled while unavailable and never sets the native disabled attribute", () => {
    const html = renderToStaticMarkup(createElement(GuardedButton, { type: "submit", unavailable: true }, "Saving"));
    expect(html).toBe('<button type="submit" aria-disabled="true">Saving</button>');
  });
});
