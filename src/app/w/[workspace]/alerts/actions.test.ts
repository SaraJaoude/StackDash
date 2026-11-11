import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceAccess } from "@/lib/workspaces/access";
import { actionDeniedReason, ForbiddenError } from "@/lib/workspaces/permissions";

import { acknowledgeAllAlerts } from "./actions";

/*
 * The "Acknowledge all" action (#268): it authorizes the caller for `acknowledge_alert` before it
 * touches anything, acknowledges in the workspace the slug resolves to (never an id from the form),
 * and reports how many it acknowledged and how many are left.
 */

const mocks = vi.hoisted(() => ({
  requireWorkspaceAction: vi.fn<(slug: string, action: string) => Promise<WorkspaceAccess>>(),
  acknowledgeAll: vi.fn<(workspaceId: string, userId: string) => Promise<number>>(),
  countUnacknowledged: vi.fn<(workspaceId: string) => Promise<number>>(),
  refresh: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/workspaces/access", () => ({ requireWorkspaceAction: mocks.requireWorkspaceAction }));
vi.mock("@/lib/data/triggered-alerts", () => ({
  acknowledgeAllTriggeredAlerts: mocks.acknowledgeAll,
  acknowledgeTriggeredAlert: vi.fn(),
  countUnacknowledgedAlerts: mocks.countUnacknowledged,
}));
vi.mock("@/lib/log/logger", () => ({ logError: () => "ref-268" }));

const ACCESS: WorkspaceAccess = {
  user: { id: "26800000-0000-4000-8000-0000000000aa", email: "e2e-owner@example.com", profile: { name: null, avatarUrl: null } },
  workspace: { id: "26800000-0000-4000-8000-000000000001", slug: "acme", name: "Acme", handle: null },
  role: "admin",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceAction.mockResolvedValue(ACCESS);
  mocks.acknowledgeAll.mockResolvedValue(0);
  mocks.countUnacknowledged.mockResolvedValue(0);
});

describe("acknowledgeAllAlerts", () => {
  it("acknowledges in the caller's workspace and name and reports the count", async () => {
    mocks.acknowledgeAll.mockResolvedValue(6);
    expect(await acknowledgeAllAlerts(null, form({ workspace: "acme" }))).toEqual({ ok: true, acknowledged: 6, remaining: 0 });
    expect(mocks.requireWorkspaceAction).toHaveBeenCalledWith("acme", "acknowledge_alert");
    expect(mocks.acknowledgeAll).toHaveBeenCalledWith(ACCESS.workspace.id, ACCESS.user.id);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("reports zero when nothing was left to acknowledge", async () => {
    mocks.acknowledgeAll.mockResolvedValue(0);
    expect(await acknowledgeAllAlerts(null, form({ workspace: "acme" }))).toEqual({ ok: true, acknowledged: 0, remaining: 0 });
  });

  it("reports the alerts still waiting past the per-call limit", async () => {
    mocks.acknowledgeAll.mockResolvedValue(100);
    mocks.countUnacknowledged.mockResolvedValue(20);
    expect(await acknowledgeAllAlerts(null, form({ workspace: "acme" }))).toEqual({ ok: true, acknowledged: 100, remaining: 20 });
  });

  it("refuses a role that cannot acknowledge, with the reason, before touching any alert", async () => {
    mocks.requireWorkspaceAction.mockRejectedValue(new ForbiddenError("admin", actionDeniedReason("acknowledge_alert")));
    expect(await acknowledgeAllAlerts(null, form({ workspace: "acme" }))).toEqual({
      ok: false,
      message: "Only owners and admins can acknowledge alerts.",
    });
    expect(mocks.acknowledgeAll).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("acknowledges in the workspace the slug resolves to, ignoring a workspace id posted beside it", async () => {
    mocks.acknowledgeAll.mockResolvedValue(1);
    await acknowledgeAllAlerts(null, form({ workspace: "acme", workspaceId: "26800000-0000-4000-8000-000000000999" }));
    expect(mocks.acknowledgeAll).toHaveBeenCalledWith(ACCESS.workspace.id, ACCESS.user.id);
  });

  it.each([
    ["no workspace", {}],
    ["an empty workspace", { workspace: "" }],
  ])("refuses a form with %s as out of date", async (_case, fields) => {
    expect(await acknowledgeAllAlerts(null, form(fields))).toEqual({
      ok: false,
      message: "This form is out of date. Reload the page and try again.",
    });
    expect(mocks.requireWorkspaceAction).not.toHaveBeenCalled();
  });

  it("returns a reference id when the write fails", async () => {
    mocks.acknowledgeAll.mockRejectedValue(new Error("Failed to acknowledge alerts"));
    expect(await acknowledgeAllAlerts(null, form({ workspace: "acme" }))).toEqual({
      ok: false,
      message: "The alerts could not be acknowledged. Try again in a moment.",
      referenceId: "ref-268",
    });
  });
});
