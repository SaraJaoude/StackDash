import { z } from "zod";
import {
  AdapterScopedKeySchema,
  issuesFromZod,
  type BatchValidation,
  type ValidationIssue,
} from "./types";

/**
 * Declared by each adapter. Events carry the id so members can hide event
 * types later (#119) without reworking stored events.
 */
export const EventTypeSchema = z.strictObject({
  id: AdapterScopedKeySchema,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(280),
  shownByDefault: z.boolean(),
});

export const EventSeveritySchema = z.enum(["info", "success", "warning", "critical"]);

/**
 * Strict so an adapter cannot attach fields the model does not name: there is
 * deliberately no field for an author, email, or other personal data.
 */
export const ActivityEventSchema = z.strictObject({
  typeId: AdapterScopedKeySchema,
  occurredAt: z.date(),
  severity: EventSeveritySchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000).optional(),
  externalAccountId: z.string().min(1),
  // Unique per adapter; the store upserts on it so a repeated poll never duplicates an event.
  dedupeKey: z.string().min(1).max(200),
  // https only: the link is rendered in the dashboard and must not downgrade or run script.
  url: z.url({ protocol: /^https$/ }).optional(),
});

export type EventType = z.infer<typeof EventTypeSchema>;
export type EventSeverity = z.infer<typeof EventSeveritySchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/**
 * Gate between an adapter's `sync` output and storage. All or nothing, like
 * metrics: an undeclared type id means the adapter and its declaration drifted.
 */
export function validateAdapterEvents(
  eventTypes: readonly EventType[],
  candidates: readonly unknown[],
): BatchValidation<ActivityEvent> {
  const declared = new Set(eventTypes.map((eventType) => eventType.id));
  const items: ActivityEvent[] = [];
  const issues: ValidationIssue[] = [];

  candidates.forEach((candidate, index) => {
    const parsed = ActivityEventSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(...issuesFromZod(index, parsed.error));
      return;
    }
    if (!declared.has(parsed.data.typeId)) {
      issues.push({ index, path: "typeId", message: "is not one of the adapter's declared event types" });
      return;
    }
    items.push(parsed.data);
  });

  return issues.length === 0 ? { ok: true, items } : { ok: false, issues };
}
