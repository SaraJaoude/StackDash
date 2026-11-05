import type { Database } from "@/lib/supabase/database.types";

/**
 * The #104 role matrix, in one place. The UI uses it to hide or disable controls with a reason;
 * Server Actions use it (through `requireWorkspace`) to authorize. Row level security enforces
 * the same ranks in the database with `public.workspace_role_rank`, so the two must change together.
 */
export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];

/** Highest rank first, the order roles are listed in the UI. */
export const WORKSPACE_ROLES = ["owner", "admin", "viewer"] as const satisfies readonly WorkspaceRole[];

// Mirrors public.workspace_role_rank: viewer 1, admin 2, owner 3.
const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  admin: 2,
  owner: 3,
};

export const WORKSPACE_ACTIONS = [
  "view",
  "acknowledge_alert",
  "manage_projects",
  "manage_connections",
  "manage_budgets",
  "manage_members",
  "rename_workspace",
  "manage_api_keys",
  "manage_billing",
  "delete_workspace",
] as const;

export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

const REQUIRED_ROLE: Record<WorkspaceAction, WorkspaceRole> = {
  view: "viewer",
  acknowledge_alert: "admin",
  manage_projects: "admin",
  manage_connections: "admin",
  manage_budgets: "admin",
  // Admins manage members too, except owners: see canManageMember.
  manage_members: "admin",
  rename_workspace: "admin",
  manage_api_keys: "admin",
  manage_billing: "owner",
  delete_workspace: "owner",
};

const DENIED_REASON: Record<WorkspaceAction, string> = {
  view: "Only members of this workspace can view it.",
  acknowledge_alert: "Only owners and admins can acknowledge alerts.",
  manage_projects: "Only owners and admins can create, rename, or delete projects.",
  manage_connections: "Only owners and admins can connect providers.",
  manage_budgets: "Only owners and admins can manage budgets and alert rules.",
  manage_members: "Only owners and admins can invite, remove, or change members.",
  rename_workspace: "Only owners and admins can rename this workspace.",
  manage_api_keys: "Only owners and admins can create, see, or revoke API keys.",
  manage_billing: "Only owners can manage billing.",
  delete_workspace: "Only owners can delete this workspace.",
};

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  viewer: "Viewer",
};

/** True when `role` ranks at or above `minRole`. */
export function hasRoleAtLeast(role: WorkspaceRole, minRole: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export function requiredRoleFor(action: WorkspaceAction): WorkspaceRole {
  return REQUIRED_ROLE[action];
}

export function canPerform(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return hasRoleAtLeast(role, REQUIRED_ROLE[action]);
}

/**
 * Member changes need more than the action check: an admin may manage admins and viewers but
 * never an owner, and only an owner may grant the owner role.
 */
export function canManageMember(actorRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  if (!canPerform(actorRole, "manage_members")) return false;
  return targetRole !== "owner" || actorRole === "owner";
}

/** User-facing copy shown beside a hidden or disabled control. */
export function actionDeniedReason(action: WorkspaceAction): string {
  return DENIED_REASON[action];
}

/** User-facing copy for a minimum role, used when a check is by role rather than action. */
export function roleRequirementReason(minRole: WorkspaceRole): string {
  switch (minRole) {
    case "owner":
      return "Only owners can do that.";
    case "admin":
      return "Only owners and admins can do that.";
    case "viewer":
      return "Only members of this workspace can do that.";
  }
}

export function roleLabel(role: WorkspaceRole): string {
  return ROLE_LABEL[role];
}

/**
 * Thrown when a signed-in member lacks the role an action needs. Server Actions catch it and
 * return `message` to the user; it is expected, so it is not logged as an error.
 */
export class ForbiddenError extends Error {
  readonly requiredRole: WorkspaceRole;

  constructor(requiredRole: WorkspaceRole, message: string = roleRequirementReason(requiredRole)) {
    super(message);
    this.name = "ForbiddenError";
    this.requiredRole = requiredRole;
  }
}
