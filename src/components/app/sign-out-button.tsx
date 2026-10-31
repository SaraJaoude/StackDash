/**
 * A plain form POST, not a link, so signing out cannot be triggered by a prefetch or a crawler.
 * The `/auth/sign-out` route handler checks the Origin header and clears the session.
 */
export function SignOutButton() {
  return (
    <form action="/auth/sign-out" method="post">
      <button
        type="submit"
        className="inline-flex min-h-9 items-center rounded-md border border-line-strong px-3 py-1.5 text-sm text-muted transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
