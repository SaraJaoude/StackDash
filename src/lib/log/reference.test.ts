import { describe, expect, it } from "vitest";

import { newReferenceId, REFERENCE_ID_PATTERN } from "@/lib/log/reference";

describe("newReferenceId", () => {
  it("matches the REF- prefix plus 8 Crockford base32 characters", () => {
    const id = newReferenceId();
    expect(id).toMatch(REFERENCE_ID_PATTERN);
    expect(id).toHaveLength(12);
  });

  it("is unique over 1000 ids and never uses ambiguous letters", () => {
    const ids = Array.from({ length: 1000 }, () => newReferenceId());
    expect(new Set(ids).size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(REFERENCE_ID_PATTERN);
      expect(id.slice(4)).not.toMatch(/[ILOU]/);
    }
  });
});
