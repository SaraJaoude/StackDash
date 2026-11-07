import { describe, expect, it } from "vitest";

import { connectionBadgeText } from "./connection-badge";

describe("connectionBadgeText", () => {
  it.each([
    { name: "one event is singular", events: 1, label: "Stripe: Acme billing, 1 event", short: "1" },
    { name: "two events are plural", events: 2, label: "Stripe: Acme billing, 2 events", short: "2" },
    { name: "the largest unshortened count", events: 999, label: "Stripe: Acme billing, 999 events", short: "999" },
    { name: "the first shortened count", events: 1000, label: "Stripe: Acme billing, 1,000 events", short: "1K" },
    { name: "one decimal in the badge", events: 1240, label: "Stripe: Acme billing, 1,240 events", short: "1.2K" },
    { name: "rounding up into millions", events: 999_999, label: "Stripe: Acme billing, 999,999 events", short: "1M" },
    { name: "the #191 scale", events: 2_300_000, label: "Stripe: Acme billing, 2,300,000 events", short: "2.3M" },
  ])("$name: $short in the badge, the exact count in the label", ({ events, label, short }) => {
    expect(connectionBadgeText({ provider: "stripe", name: "Acme billing", events })).toEqual({ label, short });
  });
});
