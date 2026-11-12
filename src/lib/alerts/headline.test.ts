import { describe, expect, it } from "vitest";

import { alertHeadline, type AlertHeadlineInput } from "./headline";

const VERCEL_BUDGET: AlertHeadlineInput = {
  kind: "budget_percent",
  provider: "vercel",
  observed_value: 94.2867,
  observed_amount_minor: 56572,
  currency: "USD",
};

describe("alertHeadline", () => {
  it("leads a budget alert with the provider, the kind, and the percent reached", () => {
    expect(alertHeadline(VERCEL_BUDGET)).toEqual({
      title: "Vercel budget at 94.3 percent",
      percent: 94.2867,
      value: "94.3 percent of the budget, $565.72 spent",
    });
  });

  it.each<[string, AlertHeadlineInput, { title: string; percent: number | null; value: string | null }]>([
    [
      "an allowance over 100 percent keeps the real percent for the bar and the words",
      { kind: "allowance_percent", provider: "github", observed_value: 104, observed_amount_minor: null, currency: null },
      { title: "GitHub allowance at 104 percent", percent: 104, value: "104 percent of the allowance" },
    ],
    [
      "a missing provider leads with the kind alone",
      { ...VERCEL_BUDGET, provider: null },
      { title: "Budget at 94.3 percent", percent: 94.2867, value: "94.3 percent of the budget, $565.72 spent" },
    ],
    [
      "a missing amount leaves the money out",
      { ...VERCEL_BUDGET, observed_amount_minor: null, currency: null },
      { title: "Vercel budget at 94.3 percent", percent: 94.2867, value: "94.3 percent of the budget" },
    ],
    [
      "a spend amount rule in a non-USD currency titles with the amount in that currency and has no bar",
      { kind: "spend_amount", provider: null, observed_value: null, observed_amount_minor: 12550, currency: "EUR" },
      { title: "Spend at €125.50", percent: null, value: "€125.50 spent" },
    ],
    [
      "a zero-decimal currency is formatted without minor digits",
      { kind: "spend_amount", provider: "vercel", observed_value: null, observed_amount_minor: 1200, currency: "JPY" },
      { title: "Vercel spend at ¥1,200", percent: null, value: "¥1,200 spent" },
    ],
    [
      "nothing observed says the threshold passed without inventing a value",
      { kind: "spend_amount", provider: "vercel", observed_value: null, observed_amount_minor: null, currency: null },
      { title: "Vercel spend passed its threshold", percent: null, value: null },
    ],
    [
      "a rule that could not be read still gets a title",
      { kind: null, provider: null, observed_value: 92, observed_amount_minor: null, currency: null },
      { title: "Alert at 92 percent", percent: 92, value: "92 percent" },
    ],
    [
      "a non-finite stored value is treated as not observed",
      { ...VERCEL_BUDGET, observed_value: Number.POSITIVE_INFINITY },
      { title: "Vercel budget at $565.72", percent: null, value: "$565.72 spent" },
    ],
    [
      "a percent just under a whole number rounds the way the sentence does",
      { ...VERCEL_BUDGET, observed_value: 99.96, observed_amount_minor: null, currency: null },
      { title: "Vercel budget at 100 percent", percent: 99.96, value: "100 percent of the budget" },
    ],
  ])("%s", (_case, input, expected) => {
    expect(alertHeadline(input)).toEqual(expected);
  });
});
