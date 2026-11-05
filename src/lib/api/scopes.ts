import { Constants, type Database } from "@/lib/supabase/database.types";

/*
 * API key scopes (#162). The list itself is the database enum `public.api_key_scope`; this module
 * adds the words the settings page shows beside each one. Every scope only reads: no key can change
 * anything in a workspace.
 */

export type ApiKeyScope = Database["public"]["Enums"]["api_key_scope"];

export const API_KEY_SCOPES = Constants.public.Enums.api_key_scope;

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, Readonly<{ label: string; description: string }>> = {
  "usage:read": { label: "Usage and spend", description: "Daily snapshots of usage, spend, allowances, and revenue." },
  "events:read": { label: "Timeline events", description: "Deployments, payments, and the other events on the timeline." },
  "alerts:read": { label: "Triggered alerts", description: "Alerts that fired and whether they were acknowledged." },
  "connections:read": {
    label: "Connection status",
    description: "Whether each provider connection works and when it last synced. Never credentials.",
  },
};
