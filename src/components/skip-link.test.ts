import { describe, expect, it } from "vitest";

import { focusSkipTarget } from "./skip-link";

/** Just enough of an element: attributes, one-shot listeners, and focus that fires `focus`. */
function fakeTarget(attributes: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(attributes));
  const listeners = new Map<string, Array<() => void>>();
  function fire(type: string) {
    const queued = listeners.get(type) ?? [];
    listeners.delete(type);
    for (const listener of queued) listener();
  }
  let focused = false;
  return {
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    focus: () => {
      if (focused || !attrs.has("tabindex")) return;
      focused = true;
      fire("focus");
    },
    blur: () => {
      if (!focused) return;
      focused = false;
      fire("blur");
    },
    get focused() {
      return focused;
    },
    attrs,
  };
}

describe("focusSkipTarget", () => {
  it("focuses the landmark for the skip, then makes it unfocusable again once focus leaves", () => {
    const target = fakeTarget();
    focusSkipTarget(target);
    expect(target.focused).toBe(true);
    expect(target.attrs.get("tabindex")).toBe("-1");

    target.blur();
    expect(target.attrs.has("tabindex")).toBe(false);
  });

  it("works again on a second skip after the first one ended", () => {
    const target = fakeTarget();
    focusSkipTarget(target);
    target.blur();
    focusSkipTarget(target);
    expect(target.focused).toBe(true);
    target.blur();
    expect(target.attrs.has("tabindex")).toBe(false);
  });

  it("leaves a target that is focusable on its own with its tabindex after focus leaves", () => {
    const target = fakeTarget({ tabindex: "0" });
    focusSkipTarget(target);
    expect(target.focused).toBe(true);
    target.blur();
    expect(target.attrs.get("tabindex")).toBe("0");
  });
});
