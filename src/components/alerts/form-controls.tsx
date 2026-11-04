"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import type { AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import { LockIcon } from "@/components/icons";
import { CUSTOM_CHOICE, type AlertScope } from "@/lib/alerts/rule-schema";
import { Constants } from "@/lib/supabase/database.types";

import { SCOPE_LABELS, type AlertFormOptions, type Option } from "./labels";

/**
 * Form building blocks for the alerts page. Each field ties its hint and error to the control
 * with `aria-describedby` and marks itself `aria-invalid`; the error summary takes focus after a
 * failed submit and links to each field.
 */

export const inputClass =
  "block min-h-10 w-full rounded-md border bg-panel-raised px-3 py-2 text-sm text-foreground";
export const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-60";
export const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-line-strong bg-panel-raised px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent disabled:opacity-60";
export const smallButtonClass =
  "inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-line-strong bg-panel-raised px-3 py-1 text-sm font-medium text-foreground transition-colors hover:border-accent disabled:opacity-60";

/** The failure part of an action result, or null. */
export function failureOf(state: AlertActionResult | null): Extract<AlertActionResult, { ok: false }> | null {
  return state !== null && !state.ok ? state : null;
}

function describedBy(...ids: Array<string | false | undefined>): string | undefined {
  const joined = ids.filter((id): id is string => typeof id === "string").join(" ");
  return joined === "" ? undefined : joined;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} className="mt-2 text-sm text-danger">
      <span className="font-medium">Error: </span>
      {message}
    </p>
  );
}

function borderFor(error: string | undefined): string {
  return error === undefined ? "border-line-strong" : "border-danger";
}

export function SelectField({
  id,
  name,
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  options,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error: string | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  options: Option[];
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(hint !== undefined && hintId, error !== undefined && errorId)}
        className={`mt-2 ${inputClass} ${borderFor(error)}`}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function TextField({
  id,
  name,
  label,
  hint,
  error,
  value,
  onChange,
  inputMode,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error: string | undefined;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "decimal" | "numeric" | "text";
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(hint !== undefined && hintId, error !== undefined && errorId)}
        className={`mt-2 ${inputClass} ${borderFor(error)}`}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/**
 * A radio group of presets plus "Custom", which reveals a text field. The custom field is only
 * rendered (and so only posted) while "Custom" is chosen.
 */
export function PresetField({
  id,
  name,
  legend,
  presets,
  value,
  onChange,
  error,
  customName,
  customLabel,
  customHint,
  customValue,
  onCustomChange,
  customError,
  customInputMode,
}: {
  id: string;
  name: string;
  legend: string;
  presets: Option[];
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  customName: string;
  customLabel: string;
  customHint: string;
  customValue: string;
  onCustomChange: (value: string) => void;
  customError: string | undefined;
  customInputMode: "decimal" | "numeric";
}) {
  const errorId = `${id}-error`;
  const choices = [...presets, { value: CUSTOM_CHOICE, label: "Custom" }];
  return (
    <fieldset aria-describedby={error === undefined ? undefined : errorId}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {choices.map((choice, index) => {
          const optionId = index === 0 ? id : `${id}-${choice.value}`;
          return (
            <label
              key={choice.value}
              htmlFor={optionId}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-panel-raised px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                value={choice.value}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
                className="size-4 accent-accent"
              />
              {choice.label}
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
      {value === CUSTOM_CHOICE ? (
        <div className="mt-3 max-w-xs">
          <TextField
            id={`${id}-custom-input`}
            name={customName}
            label={customLabel}
            hint={customHint}
            error={customError}
            value={customValue}
            onChange={onCustomChange}
            inputMode={customInputMode}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

export type ScopeValues = { scope: AlertScope; provider: string; projectId: string; connectionId: string };

/** "Applies to" plus the one target picker the chosen scope needs. */
export function ScopeFields({
  idPrefix,
  values,
  onChange,
  errors,
  options,
}: {
  idPrefix: string;
  values: ScopeValues;
  onChange: (values: Partial<ScopeValues>) => void;
  errors: Record<string, string>;
  options: AlertFormOptions;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id={`${idPrefix}-scope`}
        name="scope"
        label="Applies to"
        error={errors.scope}
        value={values.scope}
        onChange={(scope) => {
          const next = Constants.public.Enums.alert_scope.find((key) => key === scope);
          if (next !== undefined) onChange({ scope: next });
        }}
        options={Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label }))}
      />
      {values.scope === "provider" ? (
        <SelectField
          id={`${idPrefix}-provider`}
          name="provider"
          label="Provider"
          error={errors.provider}
          value={values.provider}
          onChange={(provider) => onChange({ provider })}
          placeholder="Choose a provider"
          options={options.providers}
        />
      ) : values.scope === "project" ? (
        <SelectField
          id={`${idPrefix}-projectId`}
          name="projectId"
          label="Project"
          {...(options.projects.length === 0 ? { hint: "No projects yet. Create one on the Projects page first." } : {})}
          error={errors.projectId}
          value={values.projectId}
          onChange={(projectId) => onChange({ projectId })}
          placeholder="Choose a project"
          options={options.projects}
        />
      ) : values.scope === "connection" ? (
        <SelectField
          id={`${idPrefix}-connectionId`}
          name="connectionId"
          label="Connection"
          {...(options.connections.length === 0
            ? { hint: "No connections yet. Connect a provider on the Connections page first." }
            : {})}
          error={errors.connectionId}
          value={values.connectionId}
          onChange={(connectionId) => onChange({ connectionId })}
          placeholder="Choose a connection"
          options={options.connections}
        />
      ) : null}
    </div>
  );
}

/**
 * Lists what went wrong after a failed submit and takes focus, so keyboard and screen reader users
 * land on it. Each field error links to its field.
 */
export function ErrorSummary({
  state,
  title,
  fieldIds,
}: {
  state: AlertActionResult | null;
  title: string;
  fieldIds: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const failure = failureOf(state);
  useEffect(() => {
    if (failure !== null) ref.current?.focus();
  }, [failure]);
  if (failure === null) return null;
  const fieldErrors = Object.entries(failure.fieldErrors ?? {});
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
      className="rounded-lg border border-danger/50 bg-panel-raised px-4 py-3 text-sm"
    >
      <p id={titleId} className="font-semibold text-danger">
        {title}
      </p>
      <p className="mt-1">
        {failure.message}
        {failure.referenceId === undefined ? null : (
          <>
            {" "}
            Reference <code className="font-mono text-xs">{failure.referenceId}</code>.
          </>
        )}
      </p>
      {fieldErrors.length === 0 ? null : (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {fieldErrors.map(([field, message]) => (
            <li key={field}>
              <a href={`#${fieldIds[field] ?? ""}`} className="text-danger underline underline-offset-2">
                {message}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shown in place of a control the current role cannot use. */
export function DeniedReason({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-muted">
      <LockIcon className="shrink-0" />
      <span>{children}</span>
    </p>
  );
}
