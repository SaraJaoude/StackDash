import Link from "next/link";

import { liveProviderIds } from "@/lib/adapters/types";
import { DEFAULT_CURRENCIES, minorUnitsToDecimalString, type AlertScope, type ProviderId } from "@/lib/alerts/rule-schema";
import {
  listAlertRules,
  listAllowanceMetrics,
  listAllowanceRuleCoverage,
  listScopeTargets,
  type AlertRule,
  type ConnectionOption,
} from "@/lib/data/alert-rules";
import { listBudgetOptions, listBudgets, listSnapshotCurrencies } from "@/lib/data/budgets";
import type { WorkspaceRef } from "@/lib/data/workspaces";
import { PROVIDER_NAMES } from "@/lib/providers";
import { Constants } from "@/lib/supabase/database.types";
import { workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform, type WorkspaceRole } from "@/lib/workspaces/permissions";

import { AddSuggestedAlerts } from "./add-suggested-alerts";
import { BudgetForm } from "./budget-form";
import { DeniedReason } from "./form-controls";
import {
  defaultBudgetValues,
  defaultRuleValues,
  formatMinorAmount,
  ruleToFormValues,
  type AlertFormOptions,
} from "./labels";
import { BudgetListItem, RuleListItem } from "./list-items";
import { RuleForm } from "./rule-form";

/**
 * The configuration part of the alerts page: suggested alerts, alert rules, and budgets. Exported
 * as one body so the page can place the triggered alerts list above it.
 */

const RULES_HEADING_ID = "alert-rules-title";
const BUDGETS_HEADING_ID = "budgets-title";
const ADD_RULE_HEADING_ID = "add-alert-rule";
const ADD_BUDGET_HEADING_ID = "add-budget";
const FALLBACK_CURRENCY = "USD";

type Scoped = {
  scope: AlertScope;
  provider: ProviderId | null;
  project_id: string | null;
  connection_id: string | null;
};

export async function AlertSettings({
  workspace,
  role,
  rulesAfter,
  budgetsAfter,
}: {
  workspace: WorkspaceRef;
  role: WorkspaceRole;
  rulesAfter: string | null;
  budgetsAfter: string | null;
}) {
  const canManage = canPerform(role, "manage_budgets");
  const [rules, budgets, targets, metrics, coverage, budgetOptions, snapshotCurrencies] = await Promise.all([
    listAlertRules(workspace.id, rulesAfter),
    listBudgets(workspace.id, budgetsAfter),
    listScopeTargets(workspace.id),
    listAllowanceMetrics(workspace.id),
    listAllowanceRuleCoverage(workspace.id),
    listBudgetOptions(workspace.id),
    listSnapshotCurrencies(workspace.id),
  ]);

  const projectNames = new Map(targets.projects.map((project) => [project.id, project.name]));
  const connectionsById = new Map(targets.connections.map((connection) => [connection.id, connection]));
  const budgetsById = new Map(budgetOptions.map((budget) => [budget.id, budget]));
  const metricLabels = new Map(metrics.map((metric) => [metric.metricKey, metric.label]));
  const connectionLabel = (connection: ConnectionOption) =>
    `${connection.display_name} (${PROVIDER_NAMES[connection.provider]})`;

  function scopeLabel(item: Scoped): string {
    switch (item.scope) {
      case "workspace":
        return "the whole workspace";
      case "provider":
        return item.provider === null ? "one provider" : PROVIDER_NAMES[item.provider];
      case "project": {
        const name = item.project_id === null ? undefined : projectNames.get(item.project_id);
        return name === undefined ? "one project" : `the project ${name}`;
      }
      case "connection": {
        const connection = item.connection_id === null ? undefined : connectionsById.get(item.connection_id);
        return connection === undefined ? "one connection" : `the connection ${connectionLabel(connection)}`;
      }
    }
  }

  function ruleSummary(rule: AlertRule): string {
    const percent = `${rule.threshold_percent ?? 0}%`;
    switch (rule.kind) {
      case "allowance_percent": {
        const metric =
          rule.metric_key === null ? "every allowance" : (metricLabels.get(rule.metric_key) ?? "one allowance");
        return `Alert at ${percent} of ${metric}`;
      }
      case "spend_amount":
        return rule.threshold_amount_minor === null || rule.currency === null
          ? "Alert when spend reaches an amount"
          : `Alert when spend reaches ${formatMinorAmount(rule.threshold_amount_minor, rule.currency)}`;
      case "budget_percent": {
        const budget = rule.budget_id === null ? undefined : budgetsById.get(rule.budget_id);
        return budget === undefined ? `Alert at ${percent} of a budget` : `Alert at ${percent} of the ${budget.name} budget`;
      }
    }
  }

  function ruleDetail(rule: AlertRule): string | null {
    if (rule.kind === "spend_amount" && rule.currency !== null) {
      return `Counts spend in ${rule.currency} only. Other currencies are not converted.`;
    }
    if (rule.kind === "budget_percent") {
      const budget = rule.budget_id === null ? undefined : budgetsById.get(rule.budget_id);
      return budget === undefined ? null : `Budget: ${formatMinorAmount(budget.amount_minor, budget.currency)} a month`;
    }
    return null;
  }

  const currencies = [
    ...new Set([
      ...snapshotCurrencies,
      ...DEFAULT_CURRENCIES,
      ...budgetOptions.map((budget) => budget.currency),
      ...rules.items.flatMap((rule) => (rule.currency === null ? [] : [rule.currency])),
    ]),
  ].sort();
  const defaultCurrency = snapshotCurrencies[0] ?? FALLBACK_CURRENCY;

  const liveProviders = new Set<string>(liveProviderIds);
  const connectedProviders = new Set(targets.connections.map((connection) => connection.provider));
  const options: AlertFormOptions = {
    workspaceSlug: workspace.slug,
    providers: Constants.public.Enums.provider_id
      .filter((provider) => liveProviders.has(provider) || connectedProviders.has(provider))
      .map((provider) => ({ value: provider, label: PROVIDER_NAMES[provider] })),
    projects: targets.projects.map((project) => ({ value: project.id, label: project.name })),
    connections: targets.connections.map((connection) => ({ value: connection.id, label: connectionLabel(connection) })),
    budgets: budgetOptions.map((budget) => ({
      value: budget.id,
      label: `${budget.name} (${formatMinorAmount(budget.amount_minor, budget.currency)} a month)`,
    })),
    currencies,
    defaultCurrency,
    metrics: metrics.map((metric) => {
      const provider = connectionsById.get(metric.connectionIds[0] ?? "")?.provider;
      return {
        value: metric.metricKey,
        label: provider === undefined ? metric.label : `${PROVIDER_NAMES[provider]}: ${metric.label}`,
      };
    }),
  };

  // Suggested alerts: providers with a connection that reports allowances but has no allowance
  // rule covering it (workspace-wide, provider-wide, or for that connection).
  const workspaceCovered = coverage.some((rule) => rule.scope === "workspace");
  const coveredProviders = new Set(coverage.flatMap((rule) => (rule.scope === "provider" && rule.provider !== null ? [rule.provider] : [])));
  const coveredConnections = new Set(
    coverage.flatMap((rule) => (rule.scope === "connection" && rule.connection_id !== null ? [rule.connection_id] : [])),
  );
  const suggestedProviders = workspaceCovered
    ? []
    : [
        ...new Set(
          metrics
            .flatMap((metric) => metric.connectionIds)
            .flatMap((connectionId) => {
              const connection = connectionsById.get(connectionId);
              if (connection === undefined || coveredConnections.has(connectionId)) return [];
              return coveredProviders.has(connection.provider) ? [] : [connection.provider];
            }),
        ),
      ].sort();

  const alertsPath = workspacePath(workspace.slug, "alerts");
  const pageHref = (cursors: { rulesAfter: string | null; budgetsAfter: string | null }) => {
    const query = new URLSearchParams();
    if (cursors.rulesAfter !== null) query.set("rulesAfter", cursors.rulesAfter);
    if (cursors.budgetsAfter !== null) query.set("budgetsAfter", cursors.budgetsAfter);
    const text = query.toString();
    return text === "" ? alertsPath : `${alertsPath}?${text}`;
  };
  const deniedReason = actionDeniedReason("manage_budgets");

  return (
    <>
      {canManage && suggestedProviders.length > 0 ? (
        <section aria-labelledby="suggested-alerts-title" className="mt-8 rounded-xl border border-accent/40 bg-panel">
          <div className="border-b border-line px-6 py-4">
            <h2 id="suggested-alerts-title" className="text-sm font-semibold">
              Suggested alerts
            </h2>
            <p className="mt-1 text-sm text-muted">
              These providers report allowances that no rule watches yet. Nothing is turned on until you add it.
            </p>
          </div>
          <ul className="divide-y divide-line">
            {suggestedProviders.map((provider) => (
              <li key={provider} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-sm">
                  <span className="font-medium">{PROVIDER_NAMES[provider]}:</span> alert at 75%, 90%, and 100% of
                  each allowance.
                </p>
                <AddSuggestedAlerts
                  workspaceSlug={workspace.slug}
                  provider={provider}
                  providerLabel={PROVIDER_NAMES[provider]}
                  afterAddFocusId={RULES_HEADING_ID}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby={RULES_HEADING_ID} className="mt-8 rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-6 py-4">
          <h2 id={RULES_HEADING_ID} tabIndex={-1} className="text-sm font-semibold">
            Alert rules
          </h2>
          <p className="mt-1 text-sm text-muted">
            Rules watch synced usage and spend and raise an alert in DevMacro when a threshold is crossed, at most once
            per billing period.
          </p>
        </div>

        {rules.items.length === 0 ? (
          <div className="px-6 py-5 text-sm">
            <p className="font-medium">No alert rules yet</p>
            {canManage ? (
              <p className="mt-1 text-muted">
                <a href={`#${ADD_RULE_HEADING_ID}`} className="text-accent underline underline-offset-2">
                  Add an alert rule
                </a>{" "}
                to hear about usage or spend before it becomes a problem.
              </p>
            ) : (
              <DeniedReason>{deniedReason}</DeniedReason>
            )}
          </div>
        ) : (
          <ul aria-label="Alert rules" className="divide-y divide-line">
            {rules.items.map((rule) => (
              <RuleListItem
                key={rule.id}
                ruleId={rule.id}
                summary={ruleSummary(rule)}
                scopeLabel={scopeLabel(rule)}
                detail={ruleDetail(rule)}
                paused={rule.paused}
                manage={canManage ? { options, values: ruleToFormValues(rule, defaultCurrency) } : null}
                afterDeleteFocusId={RULES_HEADING_ID}
              />
            ))}
          </ul>
        )}

        {rules.nextCursor === null && rulesAfter === null ? null : (
          <nav aria-label="Alert rule pages" className="flex flex-wrap gap-4 border-t border-line px-6 py-3 text-sm">
            {rulesAfter === null ? null : (
              <Link href={pageHref({ rulesAfter: null, budgetsAfter })} className="text-accent underline underline-offset-2">
                Show the first rules
              </Link>
            )}
            {rules.nextCursor === null ? null : (
              <Link
                href={pageHref({ rulesAfter: rules.nextCursor, budgetsAfter })}
                className="text-accent underline underline-offset-2"
              >
                Show more rules
              </Link>
            )}
          </nav>
        )}

        {canManage ? (
          <div className="border-t border-line px-6 py-5">
            <h3 id={ADD_RULE_HEADING_ID} className="mb-4 text-sm font-semibold">
              Add an alert rule
            </h3>
            <RuleForm options={options} initial={defaultRuleValues(defaultCurrency)} title="Add an alert rule" />
          </div>
        ) : rules.items.length === 0 ? null : (
          <div className="border-t border-line px-6 py-4">
            <DeniedReason>{deniedReason}</DeniedReason>
          </div>
        )}
      </section>

      <section aria-labelledby={BUDGETS_HEADING_ID} className="mt-8 rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-6 py-4">
          <h2 id={BUDGETS_HEADING_ID} tabIndex={-1} className="text-sm font-semibold">
            Budgets
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Your budget is a monthly spending limit you set yourself. It is separate from provider allowances, which
            are the usage a provider plan includes before it charges more. Budgets reset on the first of each month
            and only count spend in their own currency.
          </p>
        </div>

        {budgets.items.length === 0 ? (
          <div className="px-6 py-5 text-sm">
            <p className="font-medium">No budgets yet</p>
            {canManage ? (
              <p className="mt-1 text-muted">
                <a href={`#${ADD_BUDGET_HEADING_ID}`} className="text-accent underline underline-offset-2">
                  Add a budget
                </a>{" "}
                to alert on a percentage of what you plan to spend each month.
              </p>
            ) : (
              <DeniedReason>{deniedReason}</DeniedReason>
            )}
          </div>
        ) : (
          <ul aria-label="Budgets" className="divide-y divide-line">
            {budgets.items.map((budget) => (
              <BudgetListItem
                key={budget.id}
                budgetId={budget.id}
                name={budget.name}
                amountLabel={formatMinorAmount(budget.amount_minor, budget.currency)}
                scopeLabel={scopeLabel(budget)}
                manage={
                  canManage
                    ? {
                        options,
                        values: {
                          name: budget.name,
                          amount: minorUnitsToDecimalString(budget.amount_minor, budget.currency),
                          currency: budget.currency,
                          scope: budget.scope,
                          provider: budget.provider ?? "",
                          projectId: budget.project_id ?? "",
                          connectionId: budget.connection_id ?? "",
                        },
                      }
                    : null
                }
                afterDeleteFocusId={BUDGETS_HEADING_ID}
              />
            ))}
          </ul>
        )}

        {budgets.nextCursor === null && budgetsAfter === null ? null : (
          <nav aria-label="Budget pages" className="flex flex-wrap gap-4 border-t border-line px-6 py-3 text-sm">
            {budgetsAfter === null ? null : (
              <Link href={pageHref({ rulesAfter, budgetsAfter: null })} className="text-accent underline underline-offset-2">
                Show the first budgets
              </Link>
            )}
            {budgets.nextCursor === null ? null : (
              <Link
                href={pageHref({ rulesAfter, budgetsAfter: budgets.nextCursor })}
                className="text-accent underline underline-offset-2"
              >
                Show more budgets
              </Link>
            )}
          </nav>
        )}

        {canManage ? (
          <div className="border-t border-line px-6 py-5">
            <h3 id={ADD_BUDGET_HEADING_ID} className="mb-4 text-sm font-semibold">
              Add a budget
            </h3>
            <BudgetForm options={options} initial={defaultBudgetValues(defaultCurrency)} title="Add a budget" />
          </div>
        ) : budgets.items.length === 0 ? null : (
          <div className="border-t border-line px-6 py-4">
            <DeniedReason>{deniedReason}</DeniedReason>
          </div>
        )}
      </section>
    </>
  );
}
