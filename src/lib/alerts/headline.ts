/**
 * The short form of a triggered alert (#268): a title that says what fired and how far it got
 * ("Vercel budget at 94.3 percent"), the percent for a bar, and the value in words beside the bar.
 * Built from the stored columns the evaluator writes (src/lib/alerts/evaluate.ts), never parsed out
 * of the sentence, so the alerts page and the dashboard read every alert the same way. The full
 * sentence stays in `message`.
 *
 * Percentages use the evaluator's one decimal place, so the title never disagrees with the
 * sentence it summarizes.
 *
 * Limit: titles name the provider and the rule's kind, not the metric or budget. "Vercel bandwidth"
 * and "Vercel build minutes" both read "Vercel allowance", because the evaluator's subject (the
 * metric label, the scope, or the budget name) is not stored on `triggered_alerts`. Persisting it
 * is #297.
 */
import { formatPercentNumber } from "@/lib/alerts/evaluate";
import type { AlertRuleKind } from "@/lib/alerts/rule-schema";
import { formatMoney } from "@/lib/format";
import { PROVIDER_NAMES } from "@/lib/providers";
import type { Database } from "@/lib/supabase/database.types";

type Row = Database["public"]["Tables"]["triggered_alerts"]["Row"];

export type AlertHeadlineInput = Pick<Row, "provider" | "observed_value" | "observed_amount_minor" | "currency"> & {
  /** The rule's kind, or null when the rule could not be read. */
  kind: AlertRuleKind | null;
};

export type AlertHeadline = Readonly<{
  title: string;
  /** The percent observed, for the bar (it may pass 100); null when the rule measures an amount. */
  percent: number | null;
  /** The observed value in words, shown beside the bar so the bar never carries it alone. */
  value: string | null;
}>;

const KIND_NOUNS: Record<AlertRuleKind, string> = {
  allowance_percent: "allowance",
  budget_percent: "budget",
  spend_amount: "spend",
};

export function alertHeadline(alert: AlertHeadlineInput): AlertHeadline {
  const noun = alert.kind === null ? "alert" : KIND_NOUNS[alert.kind];
  // Without a provider (a budget or spend rule across several), the noun leads on its own.
  const subject =
    alert.provider === null ? noun.charAt(0).toUpperCase() + noun.slice(1) : `${PROVIDER_NAMES[alert.provider]} ${noun}`;
  const percent = alert.observed_value !== null && Number.isFinite(alert.observed_value) ? alert.observed_value : null;
  const amount =
    alert.observed_amount_minor === null || alert.currency === null
      ? null
      : formatMoney(alert.observed_amount_minor, alert.currency);
  const percentText = percent === null ? null : formatPercentNumber(percent);

  const ofWhat = alert.kind === "budget_percent" ? " of the budget" : alert.kind === "allowance_percent" ? " of the allowance" : "";
  let value: string | null = null;
  if (percentText !== null) value = amount === null ? `${percentText}${ofWhat}` : `${percentText}${ofWhat}, ${amount} spent`;
  else if (amount !== null) value = `${amount} spent`;

  const reached = percentText ?? amount;
  return {
    title: reached === null ? `${subject} passed its threshold` : `${subject} at ${reached}`,
    percent,
    value,
  };
}
