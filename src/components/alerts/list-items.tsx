"use client";

import { useActionState, useCallback, useId, useState, type ReactNode } from "react";

import {
  deleteAlertRule,
  deleteBudget,
  setAlertRulePausedAction,
  type AlertActionResult,
} from "@/app/w/[workspace]/alerts/actions";

import { BudgetForm } from "./budget-form";
import { ConfirmDelete } from "./confirm-delete";
import { failureOf, smallButtonClass } from "./form-controls";
import type { AlertFormOptions, BudgetFormValues, RuleFormValues } from "./labels";
import { RuleForm } from "./rule-form";

// The edit heading only exists while the editor is open, so focusing it on mount is exactly
// "focus the editor when it opens". Module level, so React never re-runs it on re-render.
function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

/**
 * One row with an inline editor. Opening the editor moves focus to its heading; closing it
 * (saved or cancelled) returns focus to the Edit button and announces the outcome. Focus moves
 * through callback refs driven by state, so nothing reads a ref during render.
 */
function EditableRow({
  summary,
  details,
  badges,
  editLabel,
  editTitle,
  actions,
  renderForm,
}: {
  summary: string;
  details: ReactNode;
  badges: ReactNode;
  editLabel: string | null;
  editTitle: string;
  actions: ReactNode;
  renderForm: (done: (message: string | null) => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // True after the editor closes: the Edit button takes focus when it mounts again. Never true on
  // first render, so loading the page does not steal focus.
  const [returnFocus, setReturnFocus] = useState(false);
  const editHeadingId = useId();
  const editButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node !== null && returnFocus) node.focus();
    },
    [returnFocus],
  );

  const done = (nextMessage: string | null) => {
    setReturnFocus(true);
    setMessage(nextMessage);
    setEditing(false);
  };

  return (
    <li className="px-6 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-medium">{summary}</p>
          <div className="mt-1 text-sm text-muted">{details}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {badges}
          {editLabel === null || editing ? null : (
            <>
              <button
                ref={editButtonRef}
                type="button"
                onClick={() => {
                  setReturnFocus(false);
                  setMessage(null);
                  setEditing(true);
                }}
                className={smallButtonClass}
              >
                {editLabel}
                <span className="sr-only">: {summary}</span>
              </button>
              {actions}
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div className="mt-4 rounded-lg border border-line bg-background/40 p-4">
          <h3 id={editHeadingId} ref={focusOnMount} tabIndex={-1} className="mb-4 text-sm font-semibold">
            {editTitle}
          </h3>
          {renderForm(done)}
        </div>
      ) : null}
      <div role="status" aria-live="polite" className="text-sm">
        {message === null ? null : <p className="mt-2 text-success">{message}</p>}
      </div>
    </li>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: "neutral" | "accent" | "muted" }) {
  const toneClass =
    tone === "accent"
      ? "border-accent/50 text-accent"
      : tone === "muted"
        ? "border-line-strong text-muted"
        : "border-success/50 text-success";
  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function PauseButton({
  workspaceSlug,
  ruleId,
  paused,
  summary,
}: {
  workspaceSlug: string;
  ruleId: string;
  paused: boolean;
  summary: string;
}) {
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    setAlertRulePausedAction,
    null,
  );
  const failure = failureOf(state);
  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <input type="hidden" name="paused" value={paused ? "false" : "true"} />
      <button type="submit" disabled={pending} className={smallButtonClass}>
        {paused ? "Resume rule" : "Pause rule"}
        <span className="sr-only">: {summary}</span>
      </button>
      <span role="status" aria-live="polite" className="basis-full text-sm">
        {pending || state === null ? null : failure === null ? (
          <span className="text-success">{paused ? "Alert rule paused." : "Alert rule resumed."}</span>
        ) : (
          <span className="text-danger">
            {failure.message}
            {failure.referenceId === undefined ? null : ` Reference ${failure.referenceId}.`}
          </span>
        )}
      </span>
    </form>
  );
}

export type RuleRowManage = { options: AlertFormOptions; values: RuleFormValues };

export function RuleListItem({
  ruleId,
  summary,
  scopeLabel,
  detail,
  paused,
  manage,
  afterDeleteFocusId,
}: {
  ruleId: string;
  summary: string;
  scopeLabel: string;
  detail: string | null;
  paused: boolean;
  /** Null for roles that can only read. */
  manage: RuleRowManage | null;
  afterDeleteFocusId: string;
}) {
  return (
    <EditableRow
      summary={summary}
      details={
        <>
          <p>Applies to {scopeLabel}</p>
          {detail === null ? null : <p>{detail}</p>}
        </>
      }
      badges={<Badge tone={paused ? "muted" : "neutral"}>{paused ? "Paused" : "Active"}</Badge>}
      editLabel={manage === null ? null : "Edit rule"}
      editTitle="Edit alert rule"
      actions={
        manage === null ? null : (
          <>
            <PauseButton
              workspaceSlug={manage.options.workspaceSlug}
              ruleId={ruleId}
              paused={paused}
              summary={summary}
            />
            <ConfirmDelete
              label="Delete rule"
              accessibleSuffix={summary}
              title="Delete this alert rule?"
              description={`${summary}, applies to ${scopeLabel}. Alerts it already raised are deleted too. This cannot be undone.`}
              confirmLabel="Delete rule"
              action={deleteAlertRule}
              fields={{ workspace: manage.options.workspaceSlug, ruleId }}
              afterDeleteFocusId={afterDeleteFocusId}
            />
          </>
        )
      }
      renderForm={(done) =>
        manage === null ? null : (
          <RuleForm
            options={manage.options}
            initial={manage.values}
            ruleId={ruleId}
            title="Edit alert rule"
            onSaved={() => done("Alert rule saved.")}
            onCancel={() => done(null)}
          />
        )
      }
    />
  );
}

export type BudgetRowManage = { options: AlertFormOptions; values: BudgetFormValues };

export function BudgetListItem({
  budgetId,
  name,
  amountLabel,
  scopeLabel,
  manage,
  afterDeleteFocusId,
}: {
  budgetId: string;
  name: string;
  amountLabel: string;
  scopeLabel: string;
  manage: BudgetRowManage | null;
  afterDeleteFocusId: string;
}) {
  return (
    <EditableRow
      summary={name}
      details={
        <>
          <p>{amountLabel} a month, resets on the first</p>
          <p>Applies to {scopeLabel}</p>
        </>
      }
      badges={<Badge tone="accent">Your budget</Badge>}
      editLabel={manage === null ? null : "Edit budget"}
      editTitle="Edit budget"
      actions={
        manage === null ? null : (
          <ConfirmDelete
            label="Delete budget"
            accessibleSuffix={name}
            title="Delete this budget?"
            description={`${name}, ${amountLabel} a month. Alert rules that use this budget are deleted too. This cannot be undone.`}
            confirmLabel="Delete budget"
            action={deleteBudget}
            fields={{ workspace: manage.options.workspaceSlug, budgetId }}
            afterDeleteFocusId={afterDeleteFocusId}
          />
        )
      }
      renderForm={(done) =>
        manage === null ? null : (
          <BudgetForm
            options={manage.options}
            initial={manage.values}
            budgetId={budgetId}
            title="Edit budget"
            onSaved={() => done("Budget saved.")}
            onCancel={() => done(null)}
          />
        )
      }
    />
  );
}
