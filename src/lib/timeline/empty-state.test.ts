import { describe, expect, it } from "vitest";

import { timelineEmptyKind } from "./empty-state";

const SYNCED_AT = "2026-11-11T09:00:00Z";

describe("timelineEmptyKind", () => {
  it("asks for a first connection when nothing is connected (boundary: zero connections)", () => {
    expect(timelineEmptyKind([])).toBe("no_connections");
  });

  it("says events are on their way while one active connection has not synced yet", () => {
    expect(timelineEmptyKind([{ status: "active", last_synced_at: null }])).toBe("first_sync");
  });

  it("says events are on their way while any one of many connections is on its first sync", () => {
    expect(
      timelineEmptyKind([
        { status: "active", last_synced_at: SYNCED_AT },
        { status: "revoked", last_synced_at: null },
        { status: "active", last_synced_at: null },
      ]),
    ).toBe("first_sync");
  });

  it("says nothing has been reported once every connection has synced (boundary: synced, no events)", () => {
    expect(
      timelineEmptyKind([
        { status: "active", last_synced_at: SYNCED_AT },
        { status: "active", last_synced_at: SYNCED_AT },
      ]),
    ).toBe("no_events");
  });

  it.each(["pending", "needs_attention", "revoked", "failed"] as const)(
    "does not promise events from a %s connection that has never synced",
    (status) => {
      expect(timelineEmptyKind([{ status, last_synced_at: null }])).toBe("no_events");
    },
  );
});
