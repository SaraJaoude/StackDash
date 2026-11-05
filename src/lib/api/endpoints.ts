import "server-only";

import type { z } from "zod";

import {
  loadConnections,
  loadEvents,
  loadProjects,
  loadTriggeredAlerts,
  loadUsageSnapshots,
  loadWorkspaces,
} from "@/lib/api/resources";
import {
  ConnectionSchema,
  EventSchema,
  EventsQuerySchema,
  NoQuerySchema,
  PageQuerySchema,
  ProjectSchema,
  TriggeredAlertSchema,
  TriggeredAlertsQuerySchema,
  UsageSnapshotSchema,
  UsageSnapshotsQuerySchema,
  WorkspaceSchema,
  type ListResponse,
} from "@/lib/api/schemas";
import type { ApiKeyScope } from "@/lib/api/scopes";

/*
 * Every /api/v1 endpoint in one list (#162). The route handlers in src/app/api/v1 are built from
 * these entries, and so is the OpenAPI document, so a path, scope, parameter, or response shape is
 * written down once.
 */

export type ApiEndpoint<Query extends z.ZodObject = z.ZodObject, Item extends z.ZodType = z.ZodType> = Readonly<{
  path: `/api/v1/${string}`;
  operationId: string;
  summary: string;
  description: string;
  /** The scope a key needs, or null when any working key may read it. */
  scope: ApiKeyScope | null;
  query: Query;
  item: Item;
  // Method syntax so a specific endpoint fits the general ApiEndpoint the OpenAPI builder lists.
  load(tokenHash: string, query: z.output<Query>): Promise<ListResponse<z.output<Item>>>;
}>;

// Keeps each entry's query and item types tied to its loader.
function endpoint<Query extends z.ZodObject, Item extends z.ZodType>(
  definition: ApiEndpoint<Query, Item>,
): ApiEndpoint<Query, Item> {
  return definition;
}

export const API_ENDPOINTS = {
  workspaces: endpoint({
    path: "/api/v1/workspaces",
    operationId: "listWorkspaces",
    summary: "The key's workspace",
    description: "The workspace the key belongs to, as a list of one. Any working key may read it.",
    scope: null,
    query: NoQuerySchema,
    item: WorkspaceSchema,
    load: (tokenHash) => loadWorkspaces(tokenHash),
  }),
  projects: endpoint({
    path: "/api/v1/projects",
    operationId: "listProjects",
    summary: "Projects",
    description: "The workspace's projects, oldest first. Any working key may read them.",
    scope: null,
    query: PageQuerySchema,
    item: ProjectSchema,
    load: loadProjects,
  }),
  connections: endpoint({
    path: "/api/v1/connections",
    operationId: "listConnections",
    summary: "Connection status",
    description: "Each provider connection's status and last sync, oldest first. Credentials are never returned.",
    scope: "connections:read",
    query: PageQuerySchema,
    item: ConnectionSchema,
    load: loadConnections,
  }),
  usageSnapshots: endpoint({
    path: "/api/v1/usage-snapshots",
    operationId: "listUsageSnapshots",
    summary: "Usage and spend snapshots",
    description:
      "One row per provider account, metric, and UTC day, newest day first. The latest day of a metric is its current value.",
    scope: "usage:read",
    query: UsageSnapshotsQuerySchema,
    item: UsageSnapshotSchema,
    load: loadUsageSnapshots,
  }),
  events: endpoint({
    path: "/api/v1/events",
    operationId: "listEvents",
    summary: "Timeline events",
    description: "The workspace timeline, newest first.",
    scope: "events:read",
    query: EventsQuerySchema,
    item: EventSchema,
    load: loadEvents,
  }),
  triggeredAlerts: endpoint({
    path: "/api/v1/triggered-alerts",
    operationId: "listTriggeredAlerts",
    summary: "Triggered alerts",
    description: "Alerts that fired, newest first.",
    scope: "alerts:read",
    query: TriggeredAlertsQuerySchema,
    item: TriggeredAlertSchema,
    load: loadTriggeredAlerts,
  }),
} as const;
