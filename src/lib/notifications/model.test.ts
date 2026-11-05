import { describe, expect, it } from "vitest";

import {
  alertSubjectKey,
  deliveryKey,
  destinationTargetKey,
  DESTINATION_FAILURE_LIMIT,
  digestJobDate,
  digestJobKey,
  digestPeriods,
  digestSubjectKey,
  emailTargetKey,
  nextDestinationHealth,
  planAlertMessages,
  planDigestTargets,
  type DeliveryAlert,
  type DeliveryDestination,
  type Recipient,
} from "./model";

function alert(id: string, fields: Partial<DeliveryAlert> = {}): DeliveryAlert {
  return {
    id,
    ruleId: `rule-${id}`,
    title: `Alert ${id}`,
    message: `Message ${id}`,
    severity: "warning",
    thresholdLabel: "90 percent",
    isEstimated: false,
    providerName: "Vercel",
    projectName: null,
    resetsAt: null,
    triggeredAt: "2026-11-05T09:00:00.000Z",
    ...fields,
  };
}

const owner: Recipient = { userId: "user-owner", email: "owner@example.com", frequency: "immediate" };
const admin: Recipient = { userId: "user-admin", email: "admin@example.com", frequency: "immediate" };

function destination(id: string, fields: Partial<DeliveryDestination> = {}): DeliveryDestination {
  return {
    id,
    kind: "discord",
    name: `Channel ${id}`,
    allRules: true,
    ruleIds: new Set(),
    digest: "off",
    status: "active",
    consecutiveFailures: 0,
    ...fields,
  };
}

describe("planAlertMessages: coalescing", () => {
  it("puts every alert of one dispatch into one message per recipient", () => {
    const messages = planAlertMessages({
      alerts: [alert("a"), alert("b"), alert("c")],
      recipients: [owner, admin],
      destinations: [],
      delivered: new Set(),
    });
    expect(messages.map((message) => [message.target.key, message.alerts.map((item) => item.id)])).toEqual([
      [emailTargetKey(owner.userId), ["a", "b", "c"]],
      [emailTargetKey(admin.userId), ["a", "b", "c"]],
    ]);
  });

  it("orders a message critical first, then oldest first", () => {
    const [message] = planAlertMessages({
      alerts: [
        alert("late-warning", { triggeredAt: "2026-11-05T10:00:00.000Z" }),
        alert("early-warning", { triggeredAt: "2026-11-05T08:00:00.000Z" }),
        alert("critical", { severity: "critical", triggeredAt: "2026-11-05T11:00:00.000Z" }),
      ],
      recipients: [owner],
      destinations: [],
      delivered: new Set(),
    });
    expect(message?.alerts.map((item) => item.id)).toEqual(["critical", "early-warning", "late-warning"]);
  });

  it("sends nothing when there are no alerts (empty boundary)", () => {
    expect(planAlertMessages({ alerts: [], recipients: [owner], destinations: [destination("d")], delivered: new Set() })).toEqual([]);
  });

  it("sends nothing when the workspace has no recipients and no channels", () => {
    expect(planAlertMessages({ alerts: [alert("a")], recipients: [], destinations: [], delivered: new Set() })).toEqual([]);
  });
});

describe("planAlertMessages: once per alert per cycle", () => {
  it("never sends an alert twice to the same target, so a retried job only sends what is missing", () => {
    const delivered = new Set([deliveryKey(alertSubjectKey("a"), emailTargetKey(owner.userId))]);
    const messages = planAlertMessages({ alerts: [alert("a"), alert("b")], recipients: [owner, admin], destinations: [], delivered });
    expect(messages.map((message) => [message.target.key, message.alerts.map((item) => item.id)])).toEqual([
      [emailTargetKey(owner.userId), ["b"]],
      [emailTargetKey(admin.userId), ["a", "b"]],
    ]);
  });

  it("leaves a target out entirely once it has every alert", () => {
    const delivered = new Set([
      deliveryKey(alertSubjectKey("a"), emailTargetKey(owner.userId)),
      deliveryKey(alertSubjectKey("a"), destinationTargetKey("d")),
    ]);
    expect(planAlertMessages({ alerts: [alert("a")], recipients: [owner], destinations: [destination("d")], delivered })).toEqual([]);
  });
});

describe("planAlertMessages: preferences and channels", () => {
  it.each([
    ["daily", 0],
    ["weekly", 0],
    ["off", 0],
    ["immediate", 1],
  ] as const)("a member set to %s gets %i immediate emails", (frequency, count) => {
    const messages = planAlertMessages({
      alerts: [alert("a")],
      recipients: [{ ...owner, frequency }],
      destinations: [],
      delivered: new Set(),
    });
    expect(messages).toHaveLength(count);
  });

  it("sends a channel only the rules chosen for it", () => {
    const chosen = destination("d", { allRules: false, ruleIds: new Set(["rule-b"]) });
    const [message] = planAlertMessages({ alerts: [alert("a"), alert("b")], recipients: [], destinations: [chosen], delivered: new Set() });
    expect(message?.alerts.map((item) => item.id)).toEqual(["b"]);
  });

  it("sends a channel with no rules chosen nothing", () => {
    const none = destination("d", { allRules: false });
    expect(planAlertMessages({ alerts: [alert("a")], recipients: [], destinations: [none], delivered: new Set() })).toEqual([]);
  });

  it("skips a channel that needs attention", () => {
    const broken = destination("d", { status: "needs_attention" });
    expect(planAlertMessages({ alerts: [alert("a")], recipients: [], destinations: [broken], delivered: new Set() })).toEqual([]);
  });
});

describe("digestPeriods", () => {
  it("is the daily digest alone on a weekday", () => {
    expect(digestPeriods("2026-11-04")).toEqual([
      { frequency: "daily", date: "2026-11-04", start: "2026-11-04T00:00:00.000Z", end: "2026-11-05T00:00:00.000Z" },
    ]);
  });

  it("adds the weekly digest, Monday to Sunday, when the summarized day is a Sunday", () => {
    expect(digestPeriods("2026-11-08")).toEqual([
      { frequency: "daily", date: "2026-11-08", start: "2026-11-08T00:00:00.000Z", end: "2026-11-09T00:00:00.000Z" },
      { frequency: "weekly", date: "2026-11-08", start: "2026-11-02T00:00:00.000Z", end: "2026-11-09T00:00:00.000Z" },
    ]);
  });

  it("has no weekly digest on the Saturday or the Monday either side", () => {
    expect(digestPeriods("2026-11-07").map((period) => period.frequency)).toEqual(["daily"]);
    expect(digestPeriods("2026-11-09").map((period) => period.frequency)).toEqual(["daily"]);
  });

  it.each(["", "2026-02-30", "not a date", "2026-11-5"])("is empty for the invalid date %j", (date) => {
    expect(digestPeriods(date)).toEqual([]);
  });
});

describe("digest job keys", () => {
  it("round trips the summarized date", () => {
    expect(digestJobDate(digestJobKey("w1", "2026-11-04"))).toBe("2026-11-04");
  });

  it.each([null, "", "daily_summary:w1:2026-11-04", "digest:w1:2026-11", "digest:w1:2026-11-04:extra"])("reads no date from %j", (key) => {
    expect(digestJobDate(key)).toBeNull();
  });
});

describe("planDigestTargets", () => {
  const [daily, weekly] = digestPeriods("2026-11-08");
  if (daily === undefined || weekly === undefined) throw new Error("fixture: 2026-11-08 is a Sunday");

  it("picks the members and channels that chose this digest", () => {
    const targets = planDigestTargets({
      period: weekly,
      recipients: [{ ...owner, frequency: "weekly" }, { ...admin, frequency: "daily" }],
      destinations: [destination("weekly", { digest: "weekly" }), destination("daily", { digest: "daily" }), destination("off")],
      delivered: new Set(),
    });
    expect(targets.map((target) => target.key)).toEqual([emailTargetKey(owner.userId), destinationTargetKey("weekly")]);
  });

  it("skips a target that already had this digest, and a channel that needs attention", () => {
    const targets = planDigestTargets({
      period: daily,
      recipients: [{ ...owner, frequency: "daily" }],
      destinations: [destination("broken", { digest: "daily", status: "needs_attention" })],
      delivered: new Set([deliveryKey(digestSubjectKey(daily), emailTargetKey(owner.userId))]),
    });
    expect(targets).toEqual([]);
  });
});

describe("nextDestinationHealth: needs attention", () => {
  it("resets the failure count on a delivery", () => {
    expect(nextDestinationHealth({ status: "needs_attention", consecutiveFailures: 5 }, "delivered")).toEqual({
      status: "active",
      consecutiveFailures: 0,
      becameNeedsAttention: false,
    });
  });

  it("stays active for transient failures below the limit", () => {
    expect(nextDestinationHealth({ status: "active", consecutiveFailures: DESTINATION_FAILURE_LIMIT - 2 }, "transient_failure")).toEqual({
      status: "active",
      consecutiveFailures: DESTINATION_FAILURE_LIMIT - 1,
      becameNeedsAttention: false,
    });
  });

  it("needs attention on the failure that reaches the limit, exactly once", () => {
    const reached = nextDestinationHealth({ status: "active", consecutiveFailures: DESTINATION_FAILURE_LIMIT - 1 }, "transient_failure");
    expect(reached).toEqual({ status: "needs_attention", consecutiveFailures: DESTINATION_FAILURE_LIMIT, becameNeedsAttention: true });
    const after = nextDestinationHealth({ status: reached.status, consecutiveFailures: reached.consecutiveFailures }, "transient_failure");
    expect(after.becameNeedsAttention).toBe(false);
    expect(after.status).toBe("needs_attention");
  });

  it("needs attention at once on a permanent failure", () => {
    expect(nextDestinationHealth({ status: "active", consecutiveFailures: 0 }, "permanent_failure")).toEqual({
      status: "needs_attention",
      consecutiveFailures: 1,
      becameNeedsAttention: true,
    });
  });
});
