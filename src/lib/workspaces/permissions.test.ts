import { describe, expect, it } from "vitest";

import {
  actionDeniedReason,
  canManageMember,
  canPerform,
  ForbiddenError,
  hasRoleAtLeast,
  requiredRoleFor,
  roleLabel,
  roleRequirementReason,
  WORKSPACE_ACTIONS,
  WORKSPACE_ROLES,
  type WorkspaceAction,
  type WorkspaceRole,
} from "@/lib/workspaces/permissions";

// The #104 matrix written out by hand, so a change to permissions.ts must also change this table.
const MATRIX: Record<WorkspaceAction, Record<WorkspaceRole, boolean>> = {
  view: { owner: true, admin: true, viewer: true },
  acknowledge_alert: { owner: true, admin: true, viewer: false },
  manage_projects: { owner: true, admin: true, viewer: false },
  manage_connections: { owner: true, admin: true, viewer: false },
  manage_budgets: { owner: true, admin: true, viewer: false },
  manage_alert_channels: { owner: true, admin: true, viewer: false },
  receive_alert_email: { owner: true, admin: true, viewer: false },
  publish_metrics: { owner: true, admin: true, viewer: false },
  manage_members: { owner: true, admin: true, viewer: false },
  rename_workspace: { owner: true, admin: true, viewer: false },
  set_workspace_handle: { owner: true, admin: true, viewer: false },
  manage_api_keys: { owner: true, admin: true, viewer: false },
  manage_billing: { owner: true, admin: false, viewer: false },
  delete_workspace: { owner: true, admin: false, viewer: false },
};

const cases = WORKSPACE_ACTIONS.flatMap((action) =>
  WORKSPACE_ROLES.map((role) => ({ action, role, allowed: MATRIX[action][role] })),
);

describe("canPerform", () => {
  it("covers every action in the matrix", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...WORKSPACE_ACTIONS].sort());
  });

  it.each(cases)("$role may $action: $allowed", ({ action, role, allowed }) => {
    expect(canPerform(role, action)).toBe(allowed);
  });
});

describe("requiredRoleFor", () => {
  it.each(WORKSPACE_ACTIONS)("%s needs the lowest role the matrix allows", (action) => {
    const required = requiredRoleFor(action);
    // Boundary: the required role is allowed, and every role ranked below it is not.
    expect(canPerform(required, action)).toBe(true);
    const below = WORKSPACE_ROLES.slice(WORKSPACE_ROLES.indexOf(required) + 1);
    for (const role of below) {
      expect(canPerform(role, action)).toBe(false);
    }
  });
});

describe("hasRoleAtLeast", () => {
  it("ranks owner above admin above viewer", () => {
    expect(hasRoleAtLeast("owner", "admin")).toBe(true);
    expect(hasRoleAtLeast("admin", "viewer")).toBe(true);
    expect(hasRoleAtLeast("viewer", "admin")).toBe(false);
    expect(hasRoleAtLeast("admin", "owner")).toBe(false);
  });

  it.each(WORKSPACE_ROLES)("%s satisfies its own rank", (role) => {
    expect(hasRoleAtLeast(role, role)).toBe(true);
  });
});

describe("canManageMember", () => {
  it.each([
    { actor: "owner", target: "owner", allowed: true },
    { actor: "owner", target: "admin", allowed: true },
    { actor: "owner", target: "viewer", allowed: true },
    { actor: "admin", target: "owner", allowed: false },
    { actor: "admin", target: "admin", allowed: true },
    { actor: "admin", target: "viewer", allowed: true },
    { actor: "viewer", target: "owner", allowed: false },
    { actor: "viewer", target: "admin", allowed: false },
    { actor: "viewer", target: "viewer", allowed: false },
  ] satisfies { actor: WorkspaceRole; target: WorkspaceRole; allowed: boolean }[])(
    "$actor managing $target: $allowed",
    ({ actor, target, allowed }) => {
      expect(canManageMember(actor, target)).toBe(allowed);
    },
  );
});

describe("user-facing copy", () => {
  it.each(WORKSPACE_ACTIONS)("%s has a sentence with no dashes", (action) => {
    const reason = actionDeniedReason(action);
    expect(reason).toMatch(/^Only .+\.$/);
    expect(reason).not.toMatch(/[\u2013\u2014!]/);
  });

  it("names the roles that can connect providers", () => {
    expect(actionDeniedReason("manage_connections")).toBe("Only owners and admins can connect providers.");
  });

  it("labels every role", () => {
    expect(WORKSPACE_ROLES.map(roleLabel)).toEqual(["Owner", "Admin", "Viewer"]);
  });
});

describe("ForbiddenError", () => {
  it("carries the required role and a user-facing message", () => {
    const error = new ForbiddenError("owner");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ForbiddenError");
    expect(error.requiredRole).toBe("owner");
    expect(error.message).toBe(roleRequirementReason("owner"));
  });
});
