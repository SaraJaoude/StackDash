import { z } from "zod";

import { providerName } from "@/lib/providers";
import { Constants, type Database } from "@/lib/supabase/database.types";

/**
 * The scope filter shared by the dashboard and the timeline: which providers, projects, and
 * provider accounts to show. Pure, so every rule here is unit tested. The filter lives in the URL
 * as repeated parameters (`?provider=vercel&project=<id>&project=unassigned&account=<id>`), so a
 * filtered view can be bookmarked. Within one dimension the values are alternatives (any of them);
 * across dimensions they all apply. Anything invalid in the URL is dropped rather than failing the
 * page.
 */

type ProviderId = Database["public"]["Enums"]["provider_id"];

/** The `project` value for accounts that belong to no project. */
export const UNASSIGNED_PROJECT = "unassigned";
export const UNASSIGNED_PROJECT_LABEL = "Unassigned";

/** Most projects or accounts one URL may filter on. */
export const MAX_SCOPE_VALUES = 50;

const PROVIDER_IDS: readonly string[] = Constants.public.Enums.provider_id;
// Same loose shape as the timeline cursor check. It keeps ids safe to place in a PostgREST list.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isProvider = (value: string): value is ProviderId => PROVIDER_IDS.includes(value);
const isUuid = (value: string): value is string => UUID_PATTERN.test(value);
const isProjectValue = (value: string): value is string => value === UNASSIGNED_PROJECT || isUuid(value);

/** Every string value of a search param, whether it appeared once or repeated. */
export function paramValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/**
 * Every valid value of a repeated parameter, deduplicated, in URL order, at most `max`. Optional
 * first: zod 4 rejects an absent key unless the schema accepts undefined.
 */
export function repeatedParam<T extends string>(isValid: (value: string) => value is T, max: number) {
  return z
    .unknown()
    .optional()
    .transform((raw) => [...new Set(paramValues(raw).map((item) => item.trim()).filter(isValid))].slice(0, max));
}

export const ScopeSearchParamsSchema = z.object({
  provider: repeatedParam(isProvider, PROVIDER_IDS.length),
  project: repeatedParam(isProjectValue, MAX_SCOPE_VALUES),
  account: repeatedParam(isUuid, MAX_SCOPE_VALUES),
});

export type ScopeFilters = Readonly<{
  providers: readonly ProviderId[];
  /** Project ids, plus `UNASSIGNED_PROJECT` for accounts without one. */
  projects: readonly string[];
  /** External account ids. */
  accounts: readonly string[];
}>;

export const EMPTY_SCOPE: ScopeFilters = { providers: [], projects: [], accounts: [] };

/** The scope filter in a request's search params. Never throws; other keys are ignored. */
export function parseScopeFilters(searchParams: Record<string, unknown>): ScopeFilters {
  const parsed = ScopeSearchParamsSchema.parse(searchParams);
  return { providers: parsed.provider, projects: parsed.project, accounts: parsed.account };
}

export function hasScopeFilters(scope: ScopeFilters): boolean {
  return scope.providers.length > 0 || scope.projects.length > 0 || scope.accounts.length > 0;
}

/** Adds the scope to `params` in the same shape `parseScopeFilters` reads. */
export function appendScopeParams(params: URLSearchParams, scope: ScopeFilters): void {
  for (const provider of scope.providers) params.append("provider", provider);
  for (const project of scope.projects) params.append("project", project);
  for (const account of scope.accounts) params.append("account", account);
}

// Applying the scope to dashboard data.

type ScopeConnection = Readonly<{ id: string; provider: ProviderId }>;
type ScopeAccount = Readonly<{ id: string; connection_id: string; project_id: string | null }>;
type ScopeProject = Readonly<{ id: string }>;
type ScopeSnapshot = Readonly<{ connection_id: string; external_account_id: string }>;

export type ScopedData<C, A, S> = Readonly<{ connections: C[]; accounts: A[]; snapshots: S[] }>;

/**
 * Narrows connections, accounts, and snapshot rows to the scope. A project the viewer cannot see
 * counts as unassigned, the same way the dashboard groups it. When a project or account is
 * selected, connections left with no matching account are dropped too, so no empty provider card
 * is shown for them.
 */
export function applyScope<C extends ScopeConnection, A extends ScopeAccount, S extends ScopeSnapshot>(
  data: Readonly<{ connections: readonly C[]; accounts: readonly A[]; projects: readonly ScopeProject[]; snapshots: readonly S[] }>,
  scope: ScopeFilters,
): ScopedData<C, A, S> {
  const knownProjects = new Set(data.projects.map((project) => project.id));
  const byProvider = data.connections.filter(
    (connection) => scope.providers.length === 0 || scope.providers.includes(connection.provider),
  );
  const providerConnections = new Set(byProvider.map((connection) => connection.id));
  const accounts = data.accounts.filter((account) => {
    if (!providerConnections.has(account.connection_id)) return false;
    if (scope.accounts.length > 0 && !scope.accounts.includes(account.id)) return false;
    if (scope.projects.length === 0) return true;
    const project =
      account.project_id !== null && knownProjects.has(account.project_id) ? account.project_id : UNASSIGNED_PROJECT;
    return scope.projects.includes(project);
  });
  const narrowsAccounts = scope.projects.length > 0 || scope.accounts.length > 0;
  const accountConnections = new Set(accounts.map((account) => account.connection_id));
  const connections = narrowsAccounts ? byProvider.filter((connection) => accountConnections.has(connection.id)) : byProvider;
  const accountIds = new Set(accounts.map((account) => account.id));
  return {
    connections,
    accounts,
    snapshots: data.snapshots.filter((row) => accountIds.has(row.external_account_id)),
  };
}

// Applying the scope to the timeline query.

export type TimelineScope = Readonly<{
  /** Empty means every provider. */
  providers: readonly ProviderId[];
  /** null means any account (and events with none); an empty list matches nothing. */
  accountIds: readonly string[] | null;
}>;

/**
 * What the timeline query filters on. `projectAccountIds` are the accounts that belong to the
 * selected projects, resolved by the caller; it is ignored when no project is selected. An account
 * and a project selected together match only accounts in both.
 */
export function timelineScope(scope: ScopeFilters, projectAccountIds: readonly string[] | null): TimelineScope {
  const byProject = scope.projects.length > 0 ? (projectAccountIds ?? []) : null;
  let accountIds: readonly string[] | null;
  if (byProject === null) accountIds = scope.accounts.length > 0 ? scope.accounts : null;
  else if (scope.accounts.length === 0) accountIds = byProject;
  else accountIds = scope.accounts.filter((id) => byProject.includes(id));
  return { providers: scope.providers, accountIds };
}

/** The selected project ids, without the unassigned marker, and whether unassigned is selected. */
export function projectSelection(scope: ScopeFilters): Readonly<{ projectIds: string[]; unassigned: boolean }> {
  return {
    projectIds: scope.projects.filter((project) => project !== UNASSIGNED_PROJECT),
    unassigned: scope.projects.includes(UNASSIGNED_PROJECT),
  };
}

// Options for the filter control.

export type ScopeOption<T extends string = string> = Readonly<{ value: T; label: string }>;

export type ScopeOptions = Readonly<{
  providers: readonly ScopeOption<ProviderId>[];
  projects: readonly ScopeOption[];
  accounts: readonly ScopeOption[];
}>;

export type ScopeSources = Readonly<{
  connections: readonly Readonly<{ id: string; provider: ProviderId; display_name: string }>[];
  /** Only accounts included in the workspace's views. */
  accounts: readonly Readonly<{ id: string; connection_id: string; display_name: string }>[];
  projects: readonly Readonly<{ id: string; name: string }>[];
}>;

const byLabel = (a: ScopeOption, b: ScopeOption) => a.label.localeCompare(b.label);

/**
 * Choices for the filter: providers the workspace connects, its projects plus Unassigned, and its
 * included accounts named with their connection. A selected value with no option (a deleted
 * project, say) is still listed, so it can be unticked.
 */
export function buildScopeOptions(sources: ScopeSources, selected: ScopeFilters): ScopeOptions {
  const connectionNames = new Map(sources.connections.map((connection) => [connection.id, connection.display_name]));
  const providers = [...new Set([...sources.connections.map((connection) => connection.provider), ...selected.providers])]
    .map((provider) => ({ value: provider, label: providerName(provider) }))
    .sort(byLabel);

  const projects: ScopeOption[] = sources.projects.map((project) => ({ value: project.id, label: project.name })).sort(byLabel);
  projects.push({ value: UNASSIGNED_PROJECT, label: UNASSIGNED_PROJECT_LABEL });
  for (const value of selected.projects) {
    if (!projects.some((option) => option.value === value)) projects.push({ value, label: "Unknown project" });
  }

  const accounts: ScopeOption[] = sources.accounts
    .map((account) => {
      const connection = connectionNames.get(account.connection_id);
      return { value: account.id, label: connection === undefined ? account.display_name : `${account.display_name} (${connection})` };
    })
    .sort(byLabel);
  for (const value of selected.accounts) {
    if (!accounts.some((option) => option.value === value)) accounts.push({ value, label: "Unknown account" });
  }
  return { providers, projects, accounts };
}

function labelsFor(values: readonly string[], options: readonly ScopeOption[]): string {
  return values.map((value) => options.find((option) => option.value === value)?.label ?? value).join(" or ");
}

/**
 * The active filter in words, for the announced result summary: "provider Vercel, project
 * Checkout". null when nothing is filtered.
 */
export function describeScope(scope: ScopeFilters, options: ScopeOptions): string | null {
  const parts: string[] = [];
  if (scope.providers.length > 0) {
    parts.push(`${scope.providers.length === 1 ? "provider" : "providers"} ${labelsFor(scope.providers, options.providers)}`);
  }
  if (scope.projects.length > 0) {
    parts.push(`${scope.projects.length === 1 ? "project" : "projects"} ${labelsFor(scope.projects, options.projects)}`);
  }
  if (scope.accounts.length > 0) {
    parts.push(`${scope.accounts.length === 1 ? "account" : "accounts"} ${labelsFor(scope.accounts, options.accounts)}`);
  }
  return parts.length === 0 ? null : parts.join(", ");
}
