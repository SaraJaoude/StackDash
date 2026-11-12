import { describe, expect, it } from "vitest";

import { accountProfile } from "@/lib/account/profile";

const AVATAR = "https://avatars.githubusercontent.com/u/1?v=4";

describe("accountProfile", () => {
  it("reads the GitHub display name and a sized avatar from GitHub sign-in metadata", () => {
    expect(
      accountProfile({ full_name: "Ada Example", name: "Ada Example", user_name: "ada", avatar_url: AVATAR }),
    ).toEqual({ name: "Ada Example", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4&s=64" });
  });

  it.each([
    ["no display name", { user_name: "ada" }, "ada"],
    ["a blank display name", { full_name: "   ", name: "", user_name: "ada" }, "ada"],
    ["a display name of the wrong type", { full_name: 42, name: null, user_name: "ada" }, "ada"],
    ["only `name` set", { name: "Ada Example", user_name: "ada" }, "Ada Example"],
    ["only the preferred username", { preferred_username: "ada" }, "ada"],
    ["padding around the name", { full_name: "  Zoë 🚀  " }, "Zoë 🚀"],
  ])("falls back by precedence with %s", (_case, metadata, name) => {
    expect(accountProfile(metadata).name).toBe(name);
  });

  it.each([
    ["missing", {}],
    ["blank", { avatar_url: " " }],
    ["not a URL", { avatar_url: "avatar.png" }],
    ["plain http", { avatar_url: "http://avatars.githubusercontent.com/u/1" }],
    ["another host the CSP blocks", { avatar_url: "https://www.gravatar.com/avatar/1" }],
    ["a look-alike host", { avatar_url: "https://avatars.githubusercontent.com.example.com/u/1" }],
    ["a non-default port", { avatar_url: "https://avatars.githubusercontent.com:8443/u/1" }],
    ["a data URL", { avatar_url: "data:image/png;base64,AAAA" }],
  ])("has no avatar when it is %s", (_case, metadata) => {
    expect(accountProfile(metadata).avatarUrl).toBeNull();
  });

  it("replaces a size GitHub already carries rather than adding a second one", () => {
    expect(accountProfile({ avatar_url: `${AVATAR}&s=460` }).avatarUrl).toBe(
      "https://avatars.githubusercontent.com/u/1?v=4&s=64",
    );
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an array", ["ada"]],
    ["a string", "ada"],
  ])("is empty when the metadata is %s", (_case, metadata) => {
    expect(accountProfile(metadata)).toEqual({ name: null, avatarUrl: null });
  });
});
