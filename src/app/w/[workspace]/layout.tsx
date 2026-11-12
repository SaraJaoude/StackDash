import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { AccountLink } from "@/components/app/account-link";
import { AppNav } from "@/components/app/app-nav";
import { ArrivalProvider, LiveIndicator } from "@/components/app/arrivals";
import { CommandPalette } from "@/components/app/command-palette";
import { LiveRefresh } from "@/components/app/live-refresh";
import { SignOutButton } from "@/components/app/sign-out-button";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { Wordmark } from "@/components/wordmark";
import { availableProviders, isProviderConfigured } from "@/lib/adapters/registry";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { getWorkspaceScope } from "@/lib/data/dashboard";
import {
  getWorkspaceMembership,
  listMyWorkspaces,
  rememberWorkspace,
  type WorkspaceMembership,
} from "@/lib/data/workspaces";
import { logError } from "@/lib/log/logger";
import { buildPaletteCommands, type PaletteScope } from "@/lib/palette/commands";
import { latestCardYear } from "@/lib/public-metrics/yearly";
import { isWorkspaceSlug, workspaceHome } from "@/lib/workspaces/paths";
import { roleLabel } from "@/lib/workspaces/permissions";

type WorkspaceParams = LayoutProps<"/w/[workspace]">["params"];

// Allows this segment an empty static shell; the layout awaits `connection()` below (#125).
export const instant = false;

/**
 * Signed-in shell for one workspace. Its HTML renders per request, never from a prerendered shell:
 * the enforced CSP nonce (src/proxy.ts) can only be stamped on scripts rendered per request, and
 * a build-time shell's inline scripts would be blocked, so the page would never hydrate (#125).
 * Inside it, everything that needs the session or the slug still streams in behind its own
 * Suspense boundary, and navigations between the pages of a workspace keep their skeletons.
 *
 * The layout does not call `notFound()`. A layout's own `not-found.tsx` cannot catch it, so the
 * pages under it call `requireWorkspace`, and the not-found page renders inside this shell.
 *
 * ArrivalProvider spans the header and the page, so the live indicator, the components that mark
 * arriving data, and the one announcement per refresh share what arrived (#171).
 */
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspace]">) {
  await connection();
  return (
    <ArrivalProvider>
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur-md">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="flex h-14 items-center gap-1.5 sm:gap-3">
              <Link href="/app" className="inline-flex min-h-6 shrink-0 items-center">
                <Wordmark />
              </Link>
              <span aria-hidden="true" className="hidden text-line-strong sm:inline">
                /
              </span>
              <Suspense fallback={<ControlsSkeleton />}>
                <HeaderControls params={params} />
              </Suspense>
            </div>
            <Suspense fallback={<NavSkeleton />}>
              <HeaderNav params={params} />
            </Suspense>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
      </div>
    </ArrivalProvider>
  );
}

/** The signed-in user, and their membership for the slug in the URL (null for an invalid slug or a non-member). */
async function loadMembership(slug: string): Promise<{ user: SessionUser; membership: WorkspaceMembership | null }> {
  // Session verification reads the clock; see requireWorkspace.
  await connection();
  const user = await requireUser(isWorkspaceSlug(slug) ? workspaceHome(slug) : "/app");
  if (!isWorkspaceSlug(slug)) return { user, membership: null };
  return { user, membership: await getWorkspaceMembership(user.id, slug) };
}

async function HeaderControls({ params }: { params: WorkspaceParams }) {
  const { workspace: slug } = await params;
  await connection();
  const [{ user, membership }, workspaces] = await Promise.all([loadMembership(slug), listMyWorkspaces()]);
  if (membership) {
    // Schedules the write for after the response; it never holds up this render.
    await rememberWorkspace(membership.workspace.id);
  }

  return (
    <>
      {/* Only for a member: the channel is scoped to a workspace the user can read. */}
      {membership ? <LiveRefresh workspaceId={membership.workspace.id} /> : null}
      <WorkspaceSwitcher
        workspaces={workspaces
          .filter(({ slug: workspaceSlug }) => isWorkspaceSlug(workspaceSlug))
          .map(({ slug: workspaceSlug, name }) => ({ slug: workspaceSlug, name, href: workspaceHome(workspaceSlug) }))}
        currentSlug={membership ? membership.workspace.slug : null}
      />
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        {membership ? <LiveIndicator /> : null}
        {membership ? (
          <span className="hidden rounded-full border border-line px-2 py-0.5 font-mono text-[11px] font-medium leading-none tracking-wide text-muted sm:inline">
            <span className="sr-only">Your role: </span>
            {roleLabel(membership.role)}
          </span>
        ) : null}
        <AccountLink profile={user.profile} />
        <SignOutButton />
      </div>
    </>
  );
}

/**
 * The command palette (#170, #265), built from what the shell can read without a query per
 * keystroke: the workspace's connections, accounts, and projects (`getWorkspaceScope` is
 * request-cached, so the dashboard and timeline share the read with this), the event types the
 * connected providers' adapters declare, and the member's workspaces (request-cached, shared with
 * the switcher). If a read fails, the palette still offers everything else and says what is missing.
 */
async function HeaderPalette({ membership }: { membership: WorkspaceMembership }) {
  const { workspace, role } = membership;
  const [scopeRead, workspacesRead] = await Promise.allSettled([getWorkspaceScope(workspace.id), listMyWorkspaces()]);
  const missing: string[] = [];
  const references: string[] = [];
  let scope: PaletteScope | null = null;
  if (scopeRead.status === "fulfilled") {
    scope = scopeRead.value;
  } else {
    // notFound(), redirect(), and a postponed request-time read signal through throws; let Next.js handle them.
    unstable_rethrow(scopeRead.reason);
    missing.push("Providers, projects, and accounts could not be loaded, so they are not listed.");
    references.push(logError("palette.scope_load_failed", scopeRead.reason, { workspaceId: workspace.id }));
  }
  let workspaces: { slug: string; name: string }[] = [];
  if (workspacesRead.status === "fulfilled") {
    workspaces = workspacesRead.value.filter((item) => isWorkspaceSlug(item.slug)).map(({ slug, name }) => ({ slug, name }));
  } else {
    unstable_rethrow(workspacesRead.reason);
    missing.push("Your other workspaces could not be loaded, so they are not listed.");
    references.push(logError("palette.workspaces_load_failed", workspacesRead.reason, { workspaceId: workspace.id }));
  }
  const notice =
    missing.length === 0
      ? null
      : `${missing.join(" ")} Reload the page to try again, and quote reference ${references.join(" and ")} if it keeps happening.`;

  const catalog = availableProviders();
  const connected = new Set(scope?.connections.map((connection) => connection.provider));
  const commands = buildPaletteCommands({
    workspaceSlug: workspace.slug,
    role,
    scope,
    eventTypeIds: catalog
      .filter((adapter) => connected.has(adapter.id))
      .flatMap((adapter) => adapter.eventTypes.map((eventType) => eventType.id)),
    configuredProviders: catalog
      .filter(isProviderConfigured)
      .map((adapter) => ({ id: adapter.id, displayName: adapter.displayName })),
    workspaces,
    // Read after the membership above, so the clock never runs during prerendering.
    reviewYear: latestCardYear(new Date()),
  });
  return <CommandPalette workspaceSlug={workspace.slug} commands={commands} notice={notice} />;
}

async function HeaderNav({ params }: { params: WorkspaceParams }) {
  const { workspace: slug } = await params;
  const { membership } = await loadMembership(slug);
  // Without a membership the page shows "not found"; links into that workspace would only repeat it.
  if (!membership) return null;
  // The palette sits at the end of the nav row rather than in the crowded top row, so it fits
  // beside the Menu button on a phone and beside the section links on a wider screen.
  return (
    <div className="flex items-start gap-2 border-t border-line md:border-t-0">
      <AppNav workspaceSlug={membership.workspace.slug} />
      <div className="flex min-h-11 shrink-0 items-center">
        <Suspense fallback={<PaletteSkeleton />}>
          <HeaderPalette membership={membership} />
        </Suspense>
      </div>
    </div>
  );
}

function ControlsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-1 items-center gap-3">
      <div className="h-8 w-32 rounded-md bg-panel-raised motion-safe:animate-pulse" />
      <div className="ml-auto h-8 w-20 rounded-md bg-panel-raised motion-safe:animate-pulse" />
    </div>
  );
}

function PaletteSkeleton() {
  return <div aria-hidden="true" className="h-9 w-9 rounded-md bg-panel-raised motion-safe:animate-pulse sm:w-24" />;
}

function NavSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-11 items-center gap-4 border-t border-line md:border-t-0">
      <div className="h-4 w-48 rounded bg-panel-raised motion-safe:animate-pulse md:w-96" />
    </div>
  );
}
