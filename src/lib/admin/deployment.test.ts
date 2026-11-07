import { describe, expect, it } from "vitest";

import { compareMigrations } from "./deployment";

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
