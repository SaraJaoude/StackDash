import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { z } from "zod";

import { EMAIL_FREQUENCY_CHOICES } from "@/components/alerts/labels";
import { Wordmark } from "@/components/wordmark";
import { unsubscribeStatus, type UnsubscribeStatus } from "@/lib/data/notification-preferences";
import { logError } from "@/lib/log/logger";
import { REFERENCE_ID_PATTERN } from "@/lib/log/reference";
import { readUnsubscribeToken } from "@/lib/notifications/unsubscribe";

import { unsubscribeFromEmail } from "./actions";

export const metadata: Metadata = { title: "Unsubscribe from alert emails", robots: { index: false } };

/*
 * The unsubscribe link in every alert email and digest (#152). It works signed out: the signed
 * token in the link names the member and the workspace. Opening the page changes nothing, because
 * mail scanners follow links; the button does (actions.ts). Mail clients that support RFC 8058
 * one-click unsubscribe post to /api/notifications/unsubscribe instead.
 */

// Query values can repeat; take the first and drop anything malformed.
const firstString = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().optional().catch(undefined),
);

const searchParamsSchema = z.object({
  token: firstString,
  ref: firstString.pipe(z.string().regex(REFERENCE_ID_PATTERN).optional().catch(undefined)),
});

const FREQUENCY_LABEL = Object.fromEntries(EMAIL_FREQUENCY_CHOICES.map((choice) => [choice.value, choice.label.toLowerCase()]));

const buttonClass =
  "inline-flex min-h-11 items-center rounded-lg bg-accent px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-60";

function SignInLink({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 text-sm">
      <Link href="/sign-in" className="underline underline-offset-4">
        {children}
      </Link>
    </p>
  );
}

function Reference({ referenceId }: { referenceId: string }) {
  return <span className="font-mono text-foreground">{referenceId}</span>;
}

async function UnsubscribeDetails({ searchParams }: { searchParams: PageProps<"/unsubscribe">["searchParams"] }) {
  const { token, ref } = searchParamsSchema.parse(await searchParams);
  const target = readUnsubscribeToken(token);
  if (target === null || token === undefined) {
    return (
      <>
        <p className="text-sm leading-6">
          This unsubscribe link is incomplete or no longer valid. Open it again from the email, or sign in and change
          your alert emails on the alerts page of your workspace.
        </p>
        <SignInLink>Sign in to DevMacro</SignInLink>
      </>
    );
  }

  let status: UnsubscribeStatus;
  try {
    status = await unsubscribeStatus(target);
  } catch (error) {
    const referenceId = logError("notifications.unsubscribe_status_failed", error, { workspaceId: target.workspaceId });
    return (
      <div role="alert" className="text-sm leading-6">
        <p>DevMacro could not check your alert emails, so nothing has changed. Reload this page in a moment.</p>
        <p className="mt-2 text-muted">
          If it keeps happening, share reference <Reference referenceId={referenceId} />.
        </p>
      </div>
    );
  }

  if (status.kind === "not_member") {
    return (
      <p className="text-sm leading-6">
        You are no longer a member of this workspace, so DevMacro sends you no alert emails for it. Nothing needs doing.
      </p>
    );
  }

  if (status.frequency === "off") {
    return (
      <>
        <p role="status" className="text-sm leading-6">
          Alert emails for <strong className="font-semibold">{status.workspaceName}</strong> are off. DevMacro sends you
          no more alert emails or digests for this workspace.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          Alerts still show in DevMacro. To get emails again, sign in and choose how often on the alerts page.
        </p>
        <SignInLink>Sign in to DevMacro</SignInLink>
      </>
    );
  }

  return (
    <>
      {ref === undefined ? null : (
        <div role="alert" className="mb-4 text-sm leading-6 text-danger">
          <p>DevMacro could not turn off your alert emails. Try again in a moment.</p>
          <p className="mt-2 text-muted">
            If it keeps happening, share reference <Reference referenceId={ref} />.
          </p>
        </div>
      )}
      <p className="text-sm leading-6">
        Your alert emails for <strong className="font-semibold">{status.workspaceName}</strong> are set to{" "}
        {FREQUENCY_LABEL[status.frequency]}. Turning them off stops every alert email and digest for this workspace.
        Alerts still show in DevMacro.
      </p>
      <form action={unsubscribeFromEmail} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={buttonClass}>
          Turn off alert emails
        </button>
      </form>
    </>
  );
}

export default function UnsubscribePage({ searchParams }: PageProps<"/unsubscribe">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-xl border border-line bg-panel px-6 py-10 sm:px-10">
        <p className="flex">
          <Link href="/" className="inline-flex min-h-6 items-center">
            <Wordmark />
          </Link>
        </p>
        <h1 className="mt-4 mb-4 text-2xl font-semibold tracking-tight">Unsubscribe from alert emails</h1>
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted">
              Checking your unsubscribe link
            </p>
          }
        >
          <UnsubscribeDetails searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
