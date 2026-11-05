import { describe, expect, it } from "vitest";

import { DEMO_USER_EMAIL, memberEmails } from "./workspace";

describe("memberEmails", () => {
  it("keeps each email once, in the order given", () => {
    expect(memberEmails(["ada@example.com", "grace@example.com", "ada@example.com"])).toEqual(["ada@example.com", "grace@example.com"]);
  });

  it("is empty when no member is given", () => {
    expect(memberEmails([])).toEqual([]);
  });

  it("refuses the demo account, even beside a real member", () => {
    expect(() => memberEmails(["ada@example.com", DEMO_USER_EMAIL])).toThrow(/is the demo account/);
  });
});
