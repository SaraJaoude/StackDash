import { describe, expect, it } from "vitest";

import { connectionBadgeText } from "./connection-badge";

describe("connectionBadgeText", () => {
  it.each([
    { events: 1, label: "Stripe: Acme billing, 1 event", short: "1" },
    { events: 2, label: "Stripe: Acme billing, 2 events", short: "2" },
    { events: 999, label: "Stripe: Acme billing, 999 events", short: "999" },
    { events: 1000, label: "Stripe: Acme billing, 1,000 events", short: "1K" },
    { events: 1240, label: "Stripe: Acme billing, 1,240 events", short: "1.2K" },
    { events: 999_999, label: "Stripe: Acme billing, 999,999 events", short: "1M" },
    { events: 2_300_000, label: "Stripe: Acme billing, 2,300,000 events", short: "2.3M" },
  ])("shortens $events in the badge but keeps the exact count in the label", ({ events, label, short }) => {
    expect(connectionBadgeText({ provider: "stripe", name: "Acme billing", events })).toEqual({ label, short });
  });
});
