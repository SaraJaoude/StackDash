import { describe, expect, it } from "vitest";

import {
  appendScopeParams,
  applyScope,
  buildScopeOptions,
  describeScope,
  EMPTY_SCOPE,
  hasScopeFilters,
  MAX_SCOPE_VALUES,
  parseScopeFilters,
  projectSelection,
  timelineScope,
  UNASSIGNED_PROJECT,
  type ScopeFilters,
} from "./scope";

const P1 = "10000000-0000-4000-8000-000000000001";
const P2 = "10000000-0000-4000-8000-000000000002";
const A1 = "20000000-0000-4000-8000-000000000001";
const A2 = "20000000-0000-4000-8000-000000000002";
const A3 = "20000000-0000-4000-8000-000000000003";

const connections = [
  { id: "c-vercel", provider: "vercel" as const, display_name: "Vercel team" },
  { id: "c-stripe", provider: "stripe" as const, display_name: "Stripe live" },
];
// A1 is in project P1, A2 has no project, A3 points at a project the viewer cannot see.
const accounts = [
  { id: A1, connection_id: "c-vercel", display_name: "Production", project_id: P1 },
  { id: A2, connection_id: "c-vercel", display_name: "Staging", project_id: null },
  { id: A3, connection_id: "c-stripe", display_name: "Payments", project_id: P2 },
];
const projects = [{ id: P1, name: "Checkout" }];
const snapshots = [
  { connection_id: "c-vercel", external_account_id: A1 },
  { connection_id: "c-vercel", external_account_id: A2 },
  { connection_id: "c-stripe", external_account_id: A3 },
  { connection_id: "c-stripe", external_account_id: "excluded-account" },
];

function scope(overrides: Partial<ScopeFilters>): ScopeFilters {
  return { ...EMPTY_SCOPE, ...overrides };
}

describe("parseScopeFilters", () => {
  it("reads repeated and single values for every dimension", () => {
    expect(parseScopeFilters({ provider: ["vercel", "stripe"], project: [P1, "unassigned"], account: A1 })).toEqual({
      providers: ["vercel", "stripe"],
      projects: [P1, UNASSIGNED_PROJECT],
      accounts: [A1],
    });
  });

  it("returns no filter for empty params and ignores other keys", () => {
    expect(parseScopeFilters({ trend: "monthly" })).toEqual(EMPTY_SCOPE);
    expect(hasScopeFilters(parseScopeFilters({}))).toBe(false);
  });

  it("drops unknown providers, non uuid ids, and injection attempts", () => {
    expect(
      parseScopeFilters({
        provider: ["bogus", "Vercel", "github"],
        project: ["Checkout", `${P1}),id.gt.(x`],
        account: ["", "  ", "1,2"],
      }),
    ).toEqual({ providers: ["github"], projects: [], accounts: [] });
  });

  it("trims and removes duplicates", () => {
    expect(parseScopeFilters({ account: [` ${A1} `, A1] }).accounts).toEqual([A1]);
  });

  it(`keeps at most ${MAX_SCOPE_VALUES} accounts`, () => {
    const many = Array.from({ length: MAX_SCOPE_VALUES + 1 }, (_, index) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    expect(parseScopeFilters({ account: many }).accounts).toHaveLength(MAX_SCOPE_VALUES);
  });

  it("round trips through appendScopeParams", () => {
    const filters = scope({ providers: ["vercel"], projects: [UNASSIGNED_PROJECT], accounts: [A2] });
    const params = new URLSearchParams();
    appendScopeParams(params, filters);
    expect(parseScopeFilters({ provider: params.getAll("provider"), project: params.getAll("project"), account: params.getAll("account") })).toEqual(filters);
  });
});

describe("applyScope", () => {
  const data = { connections, accounts, projects, snapshots };

  it("keeps everything except rows of accounts that are not included when nothing is selected", () => {
    const result = applyScope(data, EMPTY_SCOPE);
    expect(result.connections).toHaveLength(2);
    expect(result.accounts).toHaveLength(3);
    expect(result.snapshots.map((row) => row.external_account_id)).toEqual([A1, A2, A3]);
  });

  it("narrows by provider", () => {
    const result = applyScope(data, scope({ providers: ["stripe"] }));
    expect(result.connections.map((connection) => connection.id)).toEqual(["c-stripe"]);
    expect(result.snapshots.map((row) => row.external_account_id)).toEqual([A3]);
  });

  it("treats an account whose project is not visible as unassigned", () => {
    const result = applyScope(data, scope({ projects: [UNASSIGNED_PROJECT] }));
    expect(result.accounts.map((account) => account.id)).toEqual([A2, A3]);
  });

  it("drops connections left with no matching account when a project is selected", () => {
    const result = applyScope(data, scope({ projects: [P1] }));
    expect(result.connections.map((connection) => connection.id)).toEqual(["c-vercel"]);
    expect(result.snapshots.map((row) => row.external_account_id)).toEqual([A1]);
  });

  it("requires every dimension to match", () => {
    expect(applyScope(data, scope({ providers: ["stripe"], accounts: [A1] })).accounts).toEqual([]);
    expect(applyScope(data, scope({ projects: [P1], accounts: [A1, A2] })).accounts.map((account) => account.id)).toEqual([A1]);
  });
});

describe("timelineScope", () => {
  it("has no account constraint when no project or account is selected", () => {
    expect(timelineScope(scope({ providers: ["vercel"] }), null)).toEqual({ providers: ["vercel"], accountIds: null });
  });

  it("uses the selected accounts alone", () => {
    expect(timelineScope(scope({ accounts: [A1] }), null).accountIds).toEqual([A1]);
  });

  it("uses the accounts resolved from projects", () => {
    expect(timelineScope(scope({ projects: [P1] }), [A1, A2]).accountIds).toEqual([A1, A2]);
  });

  it("matches nothing when the selected projects have no accounts", () => {
    expect(timelineScope(scope({ projects: [P1] }), []).accountIds).toEqual([]);
    expect(timelineScope(scope({ projects: [P1] }), null).accountIds).toEqual([]);
  });

  it("intersects selected accounts with the project's accounts", () => {
    expect(timelineScope(scope({ projects: [P1], accounts: [A1, A3] }), [A1, A2]).accountIds).toEqual([A1]);
  });
});

describe("projectSelection", () => {
  it("splits the unassigned marker from project ids", () => {
    expect(projectSelection(scope({ projects: [P1, UNASSIGNED_PROJECT] }))).toEqual({ projectIds: [P1], unassigned: true });
    expect(projectSelection(EMPTY_SCOPE)).toEqual({ projectIds: [], unassigned: false });
  });
});

describe("buildScopeOptions and describeScope", () => {
  it("offers connected providers, projects plus Unassigned last, and accounts named with their connection", () => {
    const options = buildScopeOptions({ connections, accounts, projects }, EMPTY_SCOPE);
    expect(options.providers.map((option) => option.label)).toEqual(["Stripe", "Vercel"]);
    expect(options.projects.map((option) => option.label)).toEqual(["Checkout", "Unassigned"]);
    expect(options.accounts.map((option) => option.label)).toEqual([
      "Payments (Stripe live)",
      "Production (Vercel team)",
      "Staging (Vercel team)",
    ]);
  });

  it("keeps selected values that have no option so they can be unticked", () => {
    const options = buildScopeOptions({ connections: [], accounts: [], projects: [] }, scope({ providers: ["github"], projects: [P2], accounts: [A3] }));
    expect(options.providers).toEqual([{ value: "github", label: "GitHub" }]);
    expect(options.projects).toContainEqual({ value: P2, label: "Unknown project" });
    expect(options.accounts).toEqual([{ value: A3, label: "Unknown account" }]);
  });

  it("describes the active filter in words, or null when there is none", () => {
    const options = buildScopeOptions({ connections, accounts, projects }, EMPTY_SCOPE);
    expect(describeScope(EMPTY_SCOPE, options)).toBeNull();
    expect(describeScope(scope({ providers: ["vercel"], projects: [P1, UNASSIGNED_PROJECT] }), options)).toBe(
      "provider Vercel, projects Checkout or Unassigned",
    );
    expect(describeScope(scope({ accounts: [A1] }), options)).toBe("account Production (Vercel team)");
  });
});
