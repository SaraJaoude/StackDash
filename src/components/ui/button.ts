/**
 * The one source of button styles (#342), for `<button>`, `GuardedButton`, and links styled as
 * buttons. A variant is the look, a size the target: `lg` is the 44px call to action on sign-in and
 * error pages, `md` the 40px form button, `sm` the 36px row action, `xs` the 32px control in dense
 * lists. Both disabled states share one opacity, because `GuardedButton` marks itself
 * `aria-disabled` and a plain button uses `disabled`. Only `disabled` shows the not-allowed
 * cursor: it refuses until something changes (a confirmation typed), while `aria-disabled` is
 * `GuardedButton` busy with its own action, and the sign-in button shows a wait cursor for that.
 *
 * Callers add layout only (`mt-3`, `shrink-0`, `gap-2`, `self-start`), never another color or
 * border, so a fix to a variant reaches every button that uses it.
 */
export type ButtonVariant =
  /** The one main action of a form or page. */
  | "primary"
  /** A quieter action beside the primary one: Cancel, Hide, Clear. */
  | "secondary"
  /** An action in full-strength text with a plain border, such as Save project on an account row. */
  | "outline"
  /** A raised control in a list or toolbar: Pause, Copy code, Share. */
  | "raised"
  /** The confirm button of a destructive dialog. */
  | "danger"
  /** A destructive action that opens a confirmation: Disconnect, Unpublish everything. */
  | "danger-outline"
  /** A destructive row action that opens a confirmation: Revoke, Delete. */
  | "danger-quiet";

export type ButtonSize = "lg" | "md" | "sm" | "xs";

const BASE =
  "inline-flex items-center justify-center text-sm disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:opacity-60";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent font-medium text-background transition-opacity hover:opacity-85",
  secondary:
    "border border-line-strong text-muted transition-colors hover:text-foreground",
  outline:
    "border border-line-strong transition-colors hover:border-foreground",
  raised:
    "border border-line-strong bg-panel-raised font-medium text-foreground transition-colors hover:border-accent",
  danger:
    "bg-danger font-medium text-background transition-opacity hover:opacity-85",
  "danger-outline":
    "border border-danger/60 text-danger transition-colors hover:bg-danger/10",
  "danger-quiet":
    "border border-line-strong text-danger transition-colors hover:border-danger",
};

const SIZES: Record<ButtonSize, string> = {
  lg: "min-h-11 rounded-lg px-5 py-3",
  md: "min-h-10 rounded-md px-4 py-2",
  sm: "min-h-9 rounded-md px-3 py-1.5",
  xs: "min-h-8 min-w-8 rounded-md px-3 py-1",
};

export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize = "md",
): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}
