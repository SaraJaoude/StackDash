import { z } from "zod";

/*
 * Rules for a self-reported value (#147), shared by the form (limits and hints) and the Server
 * Action (validation). The database checks the same bounds in published_metrics_source.
 */

export const SELF_REPORTED_LABEL_MAX = 60;
export const SELF_REPORTED_UNIT_MAX = 24;
const SELF_REPORTED_VALUE_MAX = 1_000_000_000_000;

export const selfReportedFields = {
  label: z
    .string()
    .trim()
    .min(1, "Enter a name for the value.")
    .max(SELF_REPORTED_LABEL_MAX, `Use ${SELF_REPORTED_LABEL_MAX} characters or fewer.`),
  value: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number, such as 1200.")
    .transform(Number)
    .refine((value) => value <= SELF_REPORTED_VALUE_MAX, "Enter a number up to 1,000,000,000,000."),
  unit: z
    .string()
    .trim()
    .min(1, "Enter a unit, such as downloads.")
    .max(SELF_REPORTED_UNIT_MAX, `Use ${SELF_REPORTED_UNIT_MAX} characters or fewer.`),
};

export type SelfReportedField = keyof typeof selfReportedFields;
