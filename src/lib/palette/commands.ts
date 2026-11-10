import { appendScopeParams, EMPTY_SCOPE, type ScopeFilters, type ScopeOption, type ScopeOptions } from "@/lib/filters/scope";
import { typeOwnerName } from "@/lib/providers";
import { eventTypeLabel, timelineHref } from "@/lib/timeline/query";
import { WORKSPACE_SECTIONS, workspacePath, type WorkspaceSection } from "@/lib/workspaces/paths";

import type { PaletteCommand } from "./search";

/**
 * The command palette's server-side half (#170): every command for one workspace, built from data
 * the shell already holds (the scope filter's options and the adapters' declared event types), so
 * the palette runs no query of its own. Every href is built here with the same helpers the
 * screens use, so a palette result lands on exactly the URL the filter form would produce.
 */

// Record so a new workspace section fails to compile until the palette can go to it. Listed in
// `WORKSPACE_SECTIONS` order, which is the nav bar's.
const SECTION_COMMANDS: Record<WorkspaceSection, Readonly<{ label: string; keywords: string }>> = {
  timeline: { label: "Go to timeline", keywords: "events activity deploys payments" },
  dashboard: { label: "Go to dashboard", keywords: "spend usage allowances trends totals" },
  connections: { label: "Go to connections", keywords: "providers integrations" },
  alerts: { label: "Go to alerts", keywords: "rules budgets thresholds triggered" },
  projects: { label: "Go to projects", keywords: "groups" },
  settings: { label: "Go to settings", keywords: "workspace members rename" },
};

export type PaletteSources = Readonly<{
  workspaceSlug: string;
  /** The scope filter's choices: connected providers, projects plus Unassigned, included accounts. */
  scopeOptions: ScopeOptions;
  /** Event types the workspace's connected providers declare. */
  eventTypeIds: readonly string[];
  /** Providers this member may connect on this instance; empty for a viewer. */
  connectable: readonly Readonly<{ id: string; displayName: string }>[];
}>;

function dashboardHref(basePath: string, scope: ScopeFilters): string {
  const params = new URLSearchParams();
  appendScopeParams(params, scope);
  return `${basePath}?${params.toString()}`;
}

function timelineFor(basePath: string, scope: ScopeFilters, types: string[]): string {
  return timelineHref(basePath, { types, severities: [], from: null, to: null, search: null, cursor: null, scope }, null);
}

function dashboardCommand(
  kind: "provider" | "project" | "account",
  option: ScopeOption,
  scope: ScopeFilters,
  dashboardPath: string,
): PaletteCommand {
  return {
    id: `dashboard:${kind}:${option.value}`,
    label: `Show dashboard for ${kind} ${option.label}`,
    keywords: kind === "provider" ? `${option.value} spend usage` : "spend usage",
    action: { kind: "navigate", href: dashboardHref(dashboardPath, scope) },
  };
}

/**
 * Every command, in display order for a blank query: pages, dashboard scopes (providers, projects,
 * accounts), timeline views (providers, then event types), providers to connect, and the shortcut
 * list.
 */
export function buildPaletteCommands(sources: PaletteSources): PaletteCommand[] {
  const { workspaceSlug, scopeOptions } = sources;
  const dashboardPath = workspacePath(workspaceSlug, "dashboard");
  const timelinePath = workspacePath(workspaceSlug, "timeline");
  const connectionsPath = workspacePath(workspaceSlug, "connections");

  const pages: PaletteCommand[] = WORKSPACE_SECTIONS.map((section) => ({
    id: `page:${section}`,
    ...SECTION_COMMANDS[section],
    action: { kind: "navigate", href: workspacePath(workspaceSlug, section) },
  }));
  pages.push({
    id: "page:account",
    label: "Go to account",
    keywords: "profile email sign out",
    action: { kind: "navigate", href: "/account" },
  });

  const dashboard: PaletteCommand[] = [
    ...scopeOptions.providers.map((option) =>
      dashboardCommand("provider", option, { ...EMPTY_SCOPE, providers: [option.value] }, dashboardPath),
    ),
    ...scopeOptions.projects.map((option) =>
      dashboardCommand("project", option, { ...EMPTY_SCOPE, projects: [option.value] }, dashboardPath),
    ),
    ...scopeOptions.accounts.map((option) =>
      dashboardCommand("account", option, { ...EMPTY_SCOPE, accounts: [option.value] }, dashboardPath),
    ),
  ];

  const timeline: PaletteCommand[] = [
    ...scopeOptions.providers.map((option): PaletteCommand => ({
      id: `timeline:provider:${option.value}`,
      label: `Show timeline for ${option.label}`,
      keywords: `${option.value} events activity`,
      action: { kind: "navigate", href: timelineFor(timelinePath, { ...EMPTY_SCOPE, providers: [option.value] }, []) },
    })),
    ...sources.eventTypeIds.map((typeId): PaletteCommand => ({
      id: `timeline:type:${typeId}`,
      // The words the timeline's own type filter prints, so the palette and the form agree.
      label: `Show timeline for ${typeOwnerName(typeId)}: ${eventTypeLabel(typeId)}`,
      keywords: `${typeId.replaceAll(/[._]/g, " ")} events`,
      action: { kind: "navigate", href: timelineFor(timelinePath, EMPTY_SCOPE, [typeId]) },
    })),
  ];

  const connect = sources.connectable.map((provider): PaletteCommand => ({
    id: `connect:${provider.id}`,
    label: `Connect ${provider.displayName}`,
    keywords: `${provider.id} add provider integration`,
    action: { kind: "navigate", href: `${connectionsPath}/new/${provider.id}` },
  }));

  const help: PaletteCommand = {
    id: "help:shortcuts",
    label: "Show keyboard shortcuts",
    keywords: "keys help hotkeys",
    action: { kind: "shortcuts" },
  };

  return [...pages, ...dashboard, ...timeline, ...connect, help];
}
