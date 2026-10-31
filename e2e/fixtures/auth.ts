import path from "node:path";

import { test as base } from "@playwright/test";

// Synthetic accounts on reserved example.com addresses; e2e/global-setup.ts creates them.
export const E2E_USERS = {
  owner: { email: "e2e-owner@example.com", userName: "e2e-owner" },
  viewer: { email: "e2e-viewer@example.com", userName: "e2e-viewer" },
} as const;

// Absolute so the paths resolve the same from global setup, the config, and any spec.
const AUTH_DIR = path.join(__dirname, "..", ".auth");

/** Storage states written by e2e/global-setup.ts on every run (git ignored). */
export const STORAGE_STATE = {
  owner: path.join(AUTH_DIR, "owner.json"),
  viewer: path.join(AUTH_DIR, "viewer.json"),
  // A session of its own for tests that sign out, so they never end the shared owner session.
  ownerSignOut: path.join(AUTH_DIR, "owner-sign-out.json"),
} as const;

/** Signed in as the owner of a personal workspace that the viewer also belongs to. */
export const ownerTest = base.extend({ storageState: STORAGE_STATE.owner });

/** Signed in as a viewer member of the owner's workspace. */
export const viewerTest = base.extend({ storageState: STORAGE_STATE.viewer });

/** Signed in as the owner on a disposable session; use for tests that sign out. */
export const signOutTest = base.extend({ storageState: STORAGE_STATE.ownerSignOut });

export { expect } from "@playwright/test";
