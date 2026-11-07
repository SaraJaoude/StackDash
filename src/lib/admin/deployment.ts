import "server-only";

import fs from "node:fs";
import path from "node:path";

/*
 * What is running (#250): the commit, and whether the database has the migrations this build was
 * written against. The migration files ship with the /app/admin route's server output
 * (outputFileTracingIncludes in next.config.ts), the same way src/lib/docs.ts ships the docs.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
// The Supabase CLI's naming: a 14 digit UTC timestamp, then a name. The timestamp is the version.
const MIGRATION_FILE = /^(\d{14})_[^/]+\.sql$/;

/** The newest migration version in this build, or null when the files did not ship with it. */
export function expectedMigrationVersion(): string | null {
  let files: string[];
  try {
    files = fs.readdirSync(MIGRATIONS_DIR);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error("Reading the migration files failed.", { cause: error });
  }
  let newest: string | null = null;
  for (const file of files) {
    const version = MIGRATION_FILE.exec(file)?.[1];
    if (version !== undefined && (newest === null || version > newest)) newest = version;
  }
  return newest;
}

export type MigrationState = "current" | "behind" | "ahead" | "unknown";

/**
 * How the database's newest applied migration compares with this build's. Versions are fixed width
 * digit strings, so string order is time order. Either side unknown means unknown.
 */
export function compareMigrations(applied: string | null, expected: string | null): MigrationState {
  if (applied === null || expected === null) return "unknown";
  if (applied === expected) return "current";
  return applied < expected ? "behind" : "ahead";
}

export type DeploymentInfo = Readonly<{ commit: string | null; environment: string }>;

/** Vercel's system variables when deployed there; a self-hosted build has no commit to report. */
export function deploymentInfo(): DeploymentInfo {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    commit: commit === undefined || commit === "" ? null : commit.slice(0, 7),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
  };
}
