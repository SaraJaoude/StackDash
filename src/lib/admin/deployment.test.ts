import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compareMigrations, expectedMigrationVersion } from "./deployment";

describe("compareMigrations", () => {
  it.each([
    ["the same version", "20261107120000", "20261107120000", "current"],
    ["an older database", "20261106144639", "20261107120000", "behind"],
    ["a newer database", "20261108090000", "20261107120000", "ahead"],
    ["a database not migrated by the CLI", null, "20261107120000", "unknown"],
    ["a build without its migration files", "20261107120000", null, "unknown"],
  ])("reads %s", (_title, applied, expected, state) => {
    expect(compareMigrations(applied, expected)).toBe(state);
  });
});

describe("expectedMigrationVersion", () => {
  const made: string[] = [];

  function directoryWith(files: readonly string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devmacro-migrations-"));
    made.push(dir);
    for (const file of files) fs.writeFileSync(path.join(dir, file), "");
    return dir;
  }

  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is the newest version, whatever order the directory lists the files in", () => {
    const dir = directoryWith(["20261107120000_b.sql", "20261031090000_a.sql", "20261107090000_c.sql"]);
    expect(expectedMigrationVersion(dir)).toBe("20261107120000");
  });

  it("ignores files that are not CLI migrations", () => {
    const dir = directoryWith(["20261101000000_real.sql", "20991231235959.sql", "2026110800000_short.sql", "20261109000000_notes.md", ".DS_Store"]);
    expect(expectedMigrationVersion(dir)).toBe("20261101000000");
  });

  it("is null for an empty directory", () => {
    expect(expectedMigrationVersion(directoryWith([]))).toBeNull();
  });

  it("is null when the files did not ship with the build", () => {
    expect(expectedMigrationVersion(path.join(os.tmpdir(), "devmacro-no-such-directory"))).toBeNull();
  });
});
