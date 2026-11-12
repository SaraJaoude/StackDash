/**
 * Focus for a native modal `<dialog>` (#342), kept free of React and the DOM so its rules are unit
 * tested. The browser opens, traps, and closes the dialog (Escape fires `cancel` and then `close`);
 * this decides where focus goes once it has closed:
 *
 * - Dismissed (Escape, Cancel, Close): back to the element that opened it, or to the named
 *   fallback when the opener is no longer in the document.
 * - Completed (the dialog's action succeeded): to the named fallback when there is one, because
 *   the opener usually goes with the row the action removed. Without one, focus stays where the
 *   browser and the action left it: the browser returns it to the opener as the dialog closes, and
 *   an action that knows better (a status heading, the next empty state) has moved it on.
 * - Nowhere, when the close handed off to another modal (the palette opening its shortcut list),
 *   whose own close restores focus.
 */

export type FocusTarget = Readonly<{ focus: () => void; isConnected: boolean }>;
export type DialogElement = Readonly<{ open: boolean; showModal: () => void; close: () => void }>;
export type CloseReason = "dismissed" | "completed";
export type ClosedDialog = Readonly<{ reason: CloseReason; opener: FocusTarget | null }>;

export function focusAfterClose(
  reason: CloseReason,
  opener: FocusTarget | null,
  fallback: FocusTarget | null,
): FocusTarget | null {
  const order = reason === "completed" ? [fallback] : [opener, fallback];
  return order.find((target): target is FocusTarget => target !== null && target.isConnected) ?? null;
}

export type DialogController = Readonly<{
  open: (dialog: DialogElement, opener: FocusTarget | null) => void;
  close: (dialog: DialogElement, reason: CloseReason) => void;
  /** Sends focus somewhere else on the next close, such as the part of the page a result named. */
  returnFocusTo: (target: FocusTarget | null) => void;
  /** Handles the dialog's `close` event, however the dialog was closed. */
  closed: (
    dialog: DialogElement,
    context: Readonly<{
      fallback: FocusTarget | null;
      onClose: ((closed: ClosedDialog) => void) | undefined;
      /** Asked after `onClose`, which may have opened the next modal. */
      otherModalOpen: () => boolean;
    }>,
  ) => void;
}>;

export function createDialogController(): DialogController {
  let opener: FocusTarget | null = null;
  let reason: CloseReason = "dismissed";
  return {
    open(dialog, from) {
      opener = from;
      reason = "dismissed";
      if (!dialog.open) dialog.showModal();
    },
    close(dialog, next) {
      reason = next;
      dialog.close();
    },
    returnFocusTo(target) {
      opener = target;
    },
    closed(dialog, { fallback, onClose, otherModalOpen }) {
      // Chromium hides a closing dialog at once but fires `close` on the next animation frame, so
      // a shortcut pressed in between reopens it first (#225). The event then belongs to the
      // earlier close, and the open dialog keeps its own opener and focus.
      if (dialog.open) return;
      const closed: ClosedDialog = { reason, opener };
      opener = null;
      reason = "dismissed";
      onClose?.(closed);
      if (otherModalOpen()) return;
      focusAfterClose(closed.reason, closed.opener, fallback)?.focus();
    },
  };
}
