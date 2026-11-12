import { describe, expect, it, vi } from "vitest";

import { createDialogController, focusAfterClose, type ClosedDialog, type FocusTarget } from "./dialog-controller";

/** An element that records when it takes focus, and can leave the document like a deleted row. */
function target(name: string, focused: string[]): FocusTarget & { isConnected: boolean } {
  return {
    isConnected: true,
    focus: () => {
      focused.push(name);
    },
  };
}

/**
 * A native `<dialog>` as far as the controller sees it. `showModal()` and `close()` behave like the
 * browser's; `pressEscape()` is the browser closing it on Escape, which never goes through the
 * controller's `close`. Each close fires the `close` event, as the browser does.
 */
function fakeDialog(fallback: FocusTarget | null = null, otherModalOpen = () => false) {
  const controller = createDialogController();
  const closes: ClosedDialog[] = [];
  const dialog = {
    open: false,
    showModal: vi.fn(() => {
      dialog.open = true;
    }),
    close: () => {
      dialog.open = false;
      fireClose();
    },
  };
  function fireClose() {
    controller.closed(dialog, { fallback, onClose: (closed) => closes.push(closed), otherModalOpen });
  }
  return {
    controller,
    dialog,
    closes,
    fireClose,
    pressEscape: () => {
      dialog.open = false;
      fireClose();
    },
  };
}

describe("focusAfterClose", () => {
  it.each([
    ["dismissed", "opener"],
    ["completed", "fallback"],
  ] as const)("a %s close prefers the %s", (reason, expected) => {
    const focused: string[] = [];
    focusAfterClose(reason, target("opener", focused), target("fallback", focused))?.focus();
    expect(focused).toEqual([expected]);
  });

  it.each([
    ["dismissed", "fallback"],
    ["completed", "fallback"],
  ] as const)("a %s close skips an opener that left the document for the %s", (reason, expected) => {
    const focused: string[] = [];
    const opener = target("opener", focused);
    opener.isConnected = false;
    focusAfterClose(reason, opener, target("fallback", focused))?.focus();
    expect(focused).toEqual([expected]);
  });

  it("a completed close without a fallback leaves focus where the action put it", () => {
    expect(focusAfterClose("completed", target("opener", []), null)).toBeNull();
  });

  it("a completed close skips a fallback that left the document rather than refocusing the opener", () => {
    const fallback = target("fallback", []);
    fallback.isConnected = false;
    expect(focusAfterClose("completed", target("opener", []), fallback)).toBeNull();
  });

  it("returns nothing when neither target is in the document", () => {
    const opener = target("opener", []);
    const fallback = target("fallback", []);
    opener.isConnected = false;
    fallback.isConnected = false;
    expect(focusAfterClose("dismissed", opener, fallback)).toBeNull();
    expect(focusAfterClose("completed", null, null)).toBeNull();
  });
});

describe("createDialogController", () => {
  it("returns focus to the opener when Escape closes the dialog", () => {
    const focused: string[] = [];
    const { controller, dialog, closes, pressEscape } = fakeDialog(target("fallback", focused));
    const opener = target("opener", focused);
    controller.open(dialog, opener);
    expect(dialog.open).toBe(true);

    pressEscape();

    expect(dialog.open).toBe(false);
    expect(closes).toEqual([{ reason: "dismissed", opener }]);
    expect(focused).toEqual(["opener"]);
  });

  it("treats Escape as dismissed even after an earlier open completed", () => {
    const focused: string[] = [];
    const { controller, dialog, closes, pressEscape } = fakeDialog(target("fallback", focused));
    controller.open(dialog, target("opener", focused));
    controller.close(dialog, "completed");
    controller.open(dialog, target("opener", focused));
    pressEscape();
    expect(closes.map((closed) => closed.reason)).toEqual(["completed", "dismissed"]);
    expect(focused).toEqual(["fallback", "opener"]);
  });

  it("returns focus to the opener when Cancel closes the dialog", () => {
    const focused: string[] = [];
    const { controller, dialog } = fakeDialog(target("fallback", focused));
    controller.open(dialog, target("opener", focused));
    controller.close(dialog, "dismissed");
    expect(focused).toEqual(["opener"]);
  });

  it("moves focus to the fallback when the action completed", () => {
    const focused: string[] = [];
    const { controller, dialog, closes } = fakeDialog(target("fallback", focused));
    controller.open(dialog, target("opener", focused));
    controller.close(dialog, "completed");
    expect(closes.map((closed) => closed.reason)).toEqual(["completed"]);
    expect(focused).toEqual(["fallback"]);
  });

  it("moves focus to the fallback when Escape closes a dialog whose opener is gone", () => {
    const focused: string[] = [];
    const { controller, dialog, pressEscape } = fakeDialog(target("fallback", focused));
    const opener = target("opener", focused);
    controller.open(dialog, opener);
    opener.isConnected = false;
    pressEscape();
    expect(focused).toEqual(["fallback"]);
  });

  it("focuses nothing when opened from nowhere and there is no fallback", () => {
    const focused: string[] = [];
    const { controller, dialog, closes, pressEscape } = fakeDialog();
    controller.open(dialog, null);
    pressEscape();
    expect(closes).toEqual([{ reason: "dismissed", opener: null }]);
    expect(focused).toEqual([]);
  });

  it("sends focus where returnFocusTo says instead of the opener", () => {
    const focused: string[] = [];
    const { controller, dialog } = fakeDialog();
    controller.open(dialog, target("opener", focused));
    controller.returnFocusTo(target("section", focused));
    controller.close(dialog, "dismissed");
    expect(focused).toEqual(["section"]);
  });

  it("ignores a late close event once the dialog has opened again (#225)", () => {
    const focused: string[] = [];
    const { controller, dialog, closes, fireClose } = fakeDialog();
    controller.open(dialog, target("first opener", focused));
    // The browser hides the dialog, the user reopens it, and only then the first close event fires.
    dialog.open = false;
    controller.open(dialog, target("second opener", focused));
    fireClose();
    expect(closes).toEqual([]);
    expect(focused).toEqual([]);

    controller.close(dialog, "dismissed");
    expect(focused).toEqual(["second opener"]);
  });

  it("leaves focus alone when the close handed off to another modal", () => {
    const focused: string[] = [];
    const { controller, dialog, closes } = fakeDialog(target("fallback", focused), () => true);
    controller.open(dialog, target("opener", focused));
    controller.close(dialog, "dismissed");
    expect(closes).toHaveLength(1);
    expect(focused).toEqual([]);
  });

  it("does not call showModal again on a dialog that is already open", () => {
    const { controller, dialog } = fakeDialog();
    controller.open(dialog, null);
    controller.open(dialog, null);
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
  });
});
