import { describe, expect, it } from "vitest";

import { acknowledgedAllMessage } from "./labels";

describe("acknowledgedAllMessage", () => {
  it.each<[string, number, number, boolean, string]>([
    ["nothing left", 0, 0, false, "No alerts were left to acknowledge."],
    ["nothing left, history shown", 0, 0, true, "No alerts were left to acknowledge."],
    [
      "nothing acknowledged but one still waiting",
      0,
      1,
      false,
      "No alerts were acknowledged this time. 1 alert is still unacknowledged. Choose Acknowledge all again to acknowledge it.",
    ],
    [
      "nothing acknowledged but many still waiting",
      0,
      20,
      true,
      "No alerts were acknowledged this time. 20 alerts are still unacknowledged. Choose Acknowledge all again to acknowledge them.",
    ],
    [
      "one acknowledged, history hidden",
      1,
      0,
      false,
      "1 alert acknowledged. It stays in the alert history. Choose Show acknowledged alerts to see it.",
    ],
    ["one acknowledged, history shown", 1, 0, true, "1 alert acknowledged. It stays in the alert history."],
    [
      "many acknowledged, history hidden",
      3,
      0,
      false,
      "3 alerts acknowledged. They stay in the alert history. Choose Show acknowledged alerts to see them.",
    ],
    ["many acknowledged, history shown", 3, 0, true, "3 alerts acknowledged. They stay in the alert history."],
    [
      "the per-call limit reached with one left",
      100,
      1,
      true,
      "100 alerts acknowledged. They stay in the alert history. 1 alert is still unacknowledged. Choose Acknowledge all again to acknowledge it.",
    ],
    [
      "the per-call limit reached with many left, history hidden",
      100,
      20,
      false,
      "100 alerts acknowledged. They stay in the alert history. Choose Show acknowledged alerts to see them. 20 alerts are still unacknowledged. Choose Acknowledge all again to acknowledge them.",
    ],
  ])("says %s", (_case, acknowledged, remaining, showAcknowledged, expected) => {
    expect(acknowledgedAllMessage({ acknowledged, remaining }, showAcknowledged)).toBe(expected);
  });
});
