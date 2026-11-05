import { describe, expect, it } from "vitest";

import { EMPTY_SCOPE, parseScopeFilters, UNASSIGNED_PROJECT, type ScopeOptions } from "@/lib/filters/scope";
import { parseTimelineSearchParams } from "@/lib/timeline/query";

import { buildPaletteCommands, type PaletteSources } from "./commands";
import type { PaletteCommand } from "./search";

const SLUG = "abc123";
const P1 = "10000000-0000-4000-8000-000000000001";
const A1 = "20000000-0000-4000-8000-000000000001";

const SCOPE_OPTIONS: ScopeOptions = {
  providers: [{ value: "vercel", label: "Vercel" }],
  projects: [
    { value: P1, label: "Checkout & billing?" },
    { value: UNASSIGNED_PROJECT, label: "Unassigned" },
  ],
  accounts: [{ value: A1, label: "Production (Vercel team)" }],
};

const SOURCES: PaletteSources = {
  workspaceSlug: SLUG,
  scopeOptions: SCOPE_OPTIONS,
  eventTypeIds: ["vercel.deployment.failed"],
  connectable: [{ id: "resend", displayName: "Resend" }],
};

const EMPTY_SOURCES: PaletteSources = {
  workspaceSlug: SLUG,
  scopeOptions: { providers: [], projects: [], accounts: [] },
  eventTypeIds: [],
  connectable: [],
};

function hrefOf(command: PaletteCommand | undefined): string {
  if (command?.action.kind !== "navigate") throw new Error("Expected a navigation command");
  return command.action.href;
}

function byLabel(commands: readonly PaletteCommand[], label: string): PaletteCommand | undefined {
  return commands.find((command) => command.label === label);
}

/** The search params of an app-relative href, as a page's `searchParams` would hold them. */
function searchParamsOf(href: string): Record<string, string[]> {
  const params = new URL(href, "https://devmacro.example").searchParams;
  const result: Record<string, string[]> = {};
  for (const [key, value] of params) result[key] = [...(result[key] ?? []), value];
  return result;
}

describe("buildPaletteCommands", () => {
  const commands = buildPaletteCommands(SOURCES);

  it("goes to every workspace section in nav order, then the account", () => {
    expect(commands.slice(0, 7).map((command) => [command.label, hrefOf(command)])).toEqual([
      ["Go to timeline", `/w/${SLUG}/timeline`],
      ["Go to dashboard", `/w/${SLUG}/dashboard`],
      ["Go to connections", `/w/${SLUG}/connections`],
      ["Go to alerts", `/w/${SLUG}/alerts`],
      ["Go to projects", `/w/${SLUG}/projects`],
      ["Go to settings", `/w/${SLUG}/settings`],
      ["Go to account", "/account"],
    ]);
  });

  it("scopes the dashboard to one provider, project, unassigned, or account", () => {
    expect(hrefOf(byLabel(commands, "Show dashboard for provider Vercel"))).toBe(`/w/${SLUG}/dashboard?provider=vercel`);
    expect(hrefOf(byLabel(commands, "Show dashboard for project Checkout & billing?"))).toBe(
      `/w/${SLUG}/dashboard?project=${P1}`,
    );
    expect(hrefOf(byLabel(commands, "Show dashboard for project Unassigned"))).toBe(
      `/w/${SLUG}/dashboard?project=${UNASSIGNED_PROJECT}`,
    );
    expect(hrefOf(byLabel(commands, "Show dashboard for account Production (Vercel team)"))).toBe(
      `/w/${SLUG}/dashboard?account=${A1}`,
    );
  });

  it("builds dashboard hrefs the dashboard parses back to exactly that scope", () => {
    const project = searchParamsOf(hrefOf(byLabel(commands, "Show dashboard for project Checkout & billing?")));
    expect(parseScopeFilters(project)).toEqual({ ...EMPTY_SCOPE, projects: [P1] });
    const account = searchParamsOf(hrefOf(byLabel(commands, "Show dashboard for account Production (Vercel team)")));
    expect(parseScopeFilters(account)).toEqual({ ...EMPTY_SCOPE, accounts: [A1] });
  });

  it("opens the timeline for a provider or an event type, in the type filter's words", () => {
    expect(hrefOf(byLabel(commands, "Show timeline for Vercel"))).toBe(`/w/${SLUG}/timeline?provider=vercel`);
    const byType = byLabel(commands, "Show timeline for Vercel: Deployment failed");
    expect(hrefOf(byType)).toBe(`/w/${SLUG}/timeline?type=vercel.deployment.failed`);
    expect(parseTimelineSearchParams(searchParamsOf(hrefOf(byType)))).toMatchObject({
      types: ["vercel.deployment.failed"],
      severities: [],
      cursor: null,
      scope: EMPTY_SCOPE,
    });
    expect(byType?.keywords).toContain("deployment failed");
  });

  it("connects each connectable provider through its connect screen", () => {
    expect(hrefOf(byLabel(commands, "Connect Resend"))).toBe(`/w/${SLUG}/connections/new/resend`);
  });

  it("ends with the shortcut list", () => {
    expect(commands.at(-1)).toMatchObject({ label: "Show keyboard shortcuts", action: { kind: "shortcuts" } });
  });

  it("gives every command a unique id", () => {
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
  });

  it("offers only pages and the shortcut list when the workspace has nothing connected and the member cannot connect", () => {
    const bare = buildPaletteCommands(EMPTY_SOURCES);
    expect(bare.map((command) => command.id)).toEqual([
      "page:timeline",
      "page:dashboard",
      "page:connections",
      "page:alerts",
      "page:projects",
      "page:settings",
      "page:account",
      "help:shortcuts",
    ]);
  });

  it("keeps a thousand accounts as a thousand distinct commands", () => {
    const accounts = Array.from({ length: 1000 }, (_, index) => ({
      value: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      label: `Account ${index}`,
    }));
    const many = buildPaletteCommands({ ...EMPTY_SOURCES, scopeOptions: { ...EMPTY_SOURCES.scopeOptions, accounts } });
    const accountCommands = many.filter((command) => command.id.startsWith("dashboard:account:"));
    expect(accountCommands).toHaveLength(1000);
    expect(new Set(many.map((command) => command.id)).size).toBe(many.length);
  });
});
