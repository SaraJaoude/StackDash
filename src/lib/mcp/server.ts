import "server-only";

import { McpServer, type AuthInfo, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { requireApiScope, type ApiPrincipal } from "@/lib/api/auth";
import { API_ENDPOINTS } from "@/lib/api/endpoints";
import { reportApiError } from "@/lib/api/errors";
import {
  ConnectionSchema,
  EventSchema,
  EventsQuerySchema,
  PageQuerySchema,
  ProjectSchema,
  TriggeredAlertSchema,
  TriggeredAlertsQuerySchema,
  UsageSnapshotSchema,
  UsageSnapshotsQuerySchema,
  WorkspaceSchema,
  type ApiTriggeredAlert,
} from "@/lib/api/schemas";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/api/scopes";
import { listDocs, type DocPage } from "@/lib/docs";
import { formatMoney, formatQuantity } from "@/lib/format";

/*
 * The read-only MCP server (#163). Every tool reads through the REST API's loaders
 * (src/lib/api/resources.ts, listed with their scopes in API_ENDPOINTS) with the hash of the key
 * that authenticateApiRequest already checked, so the database decides which workspace a key reads
 * exactly as it does for /api/v1. Nothing here looks a key up or writes anything.
 *
 * Spend never reaches a key without usage:read: get_usage needs that scope, and list_events and
 * list_alerts withhold the fields that can quote an amount (event text written by providers and by
 * DevMacro's own alerts and daily summaries, an alert's message and money). The decision and its
 * evidence are on #163.
 */

export const MCP_SERVER_INFO = { name: "devmacro", title: "DevMacro", version: "1.0.0" } as const;

/** URI of a provider page from docs/providers, as a resource. */
export const PROVIDER_DOC_URI_PREFIX = "devmacro://docs/providers/";

const INSTRUCTIONS = [
  "DevMacro reads one workspace's developer stack: usage, spend, allowances, revenue, timeline events, triggered alerts, and connection status. Every tool only reads.",
  "Money is amount_minor, an integer in the minor unit of currency (cents for USD), and display shows it formatted. Never add amounts in different currencies.",
  "provenance is verified when the provider reported a number and estimated when DevMacro calculated it from a price list (pricing_source). Say which when you quote a number.",
  "retrieved_at on a usage row is when DevMacro fetched it from the provider. read_at is when this answer was read. simulated true means the provider simulator made the data up.",
  "Usage rows are one per account, metric, and UTC day, newest day first: the latest day of a metric is its current value. Lists are paged: pass next_cursor back as cursor, with the same filters.",
  "withheld names fields this key cannot read and the scope that would return them.",
  "The provider pages under devmacro://docs/providers/ explain each metric and whether it is verified or estimated.",
].join("\n");

// Every tool reads, never changes anything, and answers from DevMacro's own database.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const timestamp = z.iso.datetime({ offset: true });

const readAt = timestamp.meta({ description: "When DevMacro read this answer from its database." });
const nextCursor = z
  .string()
  .nullable()
  .meta({ description: "Pass as cursor, with the same filters, to read the next page. Null on the last page." });
const display = z
  .string()
  .nullable()
  .meta({ description: "The amount or quantity formatted for people, for example $12.50 or 1,200 emails." });
const withheld = z
  .object({
    fields: z.array(z.string()),
    scope: z.enum(API_KEY_SCOPES),
    reason: z.string(),
  })
  .nullable()
  .meta({ description: "Fields this key cannot read, set to null in every item, and the scope that would return them." });

const WithheldText = z.string().nullable();

const McpUsageSnapshotSchema = UsageSnapshotSchema.extend({ display });
const McpEventSchema = EventSchema.extend({
  title: WithheldText.meta({ description: "Null when withheld." }),
  body: WithheldText,
});
const McpTriggeredAlertSchema = TriggeredAlertSchema.extend({
  message: WithheldText.meta({ description: "Null when withheld." }),
  threshold_label: WithheldText,
  display,
});

// Tool arguments arrive as JSON, so `acknowledged` is a boolean here rather than the query string's "true".
const AlertsInputSchema = TriggeredAlertsQuerySchema.extend({
  acknowledged: z
    .boolean()
    .optional()
    .meta({ description: "true for acknowledged alerts only, false for unacknowledged only. Leave it out for both." }),
});

function page<Item extends z.ZodType>(item: Item) {
  return { read_at: readAt, data: z.array(item), next_cursor: nextCursor };
}

const ProjectsOutputSchema = z.object({ workspace: WorkspaceSchema, ...page(ProjectSchema) });
const ConnectionsOutputSchema = z.object(page(ConnectionSchema));
const UsageOutputSchema = z.object(page(McpUsageSnapshotSchema));
const EventsOutputSchema = z.object({ ...page(McpEventSchema), withheld });
const AlertsOutputSchema = z.object({ ...page(McpTriggeredAlertSchema), withheld });

type Withheld = z.infer<typeof withheld>;

const SPEND_SCOPE: ApiKeyScope = "usage:read";
const EVENT_TEXT_FIELDS = ["title", "body"] as const;
const ALERT_MONEY_FIELDS = ["message", "threshold_label", "observed_amount_minor", "currency", "display"] as const;

function withheldFor(principal: ApiPrincipal, fields: readonly string[], reason: string): Withheld {
  return principal.scopes.includes(SPEND_SCOPE) ? null : { fields: [...fields], scope: SPEND_SCOPE, reason };
}

/** The amount or the quantity formatted for people, or null when the row carries neither. */
function displayOf(amountMinor: number | null, currency: string | null, value: number | null, unit: string | null) {
  if (amountMinor !== null && currency !== null) return formatMoney(amountMinor, currency);
  if (value !== null && unit !== null) return formatQuantity(value, unit);
  return null;
}

function alertItem(row: ApiTriggeredAlert, hideMoney: boolean): z.infer<typeof McpTriggeredAlertSchema> {
  if (hideMoney) {
    return { ...row, message: null, threshold_label: null, observed_amount_minor: null, currency: null, display: null };
  }
  return { ...row, display: displayOf(row.observed_amount_minor, row.currency, null, null) };
}

/**
 * Runs one tool call: the scope check first (requireApiScope, the same 403 the REST API answers),
 * then the read. A refusal or failure becomes a tool error the model can read, with the reference
 * id the log carries; internals stay in the log.
 */
async function runTool<Output extends Record<string, unknown>>(
  principal: ApiPrincipal,
  scope: ApiKeyScope | null,
  read: () => Promise<Output>,
): Promise<CallToolResult> {
  try {
    if (scope !== null) requireApiScope(principal, scope);
    const output = await read();
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
  } catch (error) {
    const { apiError, referenceId } = reportApiError(error);
    return { content: [{ type: "text", text: `${apiError.message} Reference ${referenceId}.` }], isError: true };
  }
}

function readAtNow(): string {
  return new Date().toISOString();
}

// docs/ ships with the deployment and never changes while it runs, so it is read once per process.
let providerDocsMemo: readonly DocPage[] | undefined;
function providerDocs(): readonly DocPage[] {
  providerDocsMemo ??= listDocs().filter((doc) => doc.group === "providers");
  return providerDocsMemo;
}

/** The ApiPrincipal the route handler authenticated, carried through the SDK's pass-through authInfo. */
export function authInfoFor(principal: ApiPrincipal): AuthInfo {
  // `token` holds the key's hash, never the key: the read functions take the hash.
  return {
    token: principal.tokenHash,
    clientId: principal.keyId,
    scopes: [...principal.scopes],
    extra: { workspaceId: principal.workspaceId },
  };
}

export function principalFrom(authInfo: AuthInfo | undefined): ApiPrincipal {
  const workspaceId = authInfo?.extra?.workspaceId;
  if (authInfo === undefined || typeof workspaceId !== "string") {
    throw new Error("The MCP server was called without an authenticated API key.");
  }
  return {
    keyId: authInfo.clientId,
    workspaceId,
    scopes: API_KEY_SCOPES.filter((scope) => authInfo.scopes.includes(scope)),
    tokenHash: authInfo.token,
  };
}

/** One server instance for one authenticated request (the SDK's per-request factory). */
export function createDevMacroMcpServer(principal: ApiPrincipal): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: INSTRUCTIONS });
  const { tokenHash } = principal;

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "The workspace this key belongs to and its projects, oldest first. A project groups provider accounts into one product; pass its id as project_id to get_usage. Any working key may call it.",
      inputSchema: PageQuerySchema,
      outputSchema: ProjectsOutputSchema,
      annotations: READ_ONLY,
    },
    (query) =>
      runTool(principal, API_ENDPOINTS.projects.scope, async () => {
        const [workspaces, projects] = await Promise.all([
          API_ENDPOINTS.workspaces.load(tokenHash, {}),
          API_ENDPOINTS.projects.load(tokenHash, query),
        ]);
        const workspace = workspaces.data[0];
        if (workspace === undefined) throw new Error("The authenticated key's workspace was not found.");
        return { workspace, read_at: readAtNow(), ...projects };
      }),
  );

  server.registerTool(
    "get_usage",
    {
      title: "Get usage and spend",
      description:
        "Daily snapshots of usage, spend, allowances, credit balances, and revenue: one row per provider account, metric, and UTC day, newest day first. The latest day of a metric is its current value, so remaining_allowance on the newest day answers how much quota is left. Filter by provider, project_id, a period (from and to, UTC days), metric_key, or kind. Needs the usage:read scope.",
      inputSchema: UsageSnapshotsQuerySchema,
      outputSchema: UsageOutputSchema,
      annotations: READ_ONLY,
    },
    (query) =>
      runTool(principal, API_ENDPOINTS.usageSnapshots.scope, async () => {
        const result = await API_ENDPOINTS.usageSnapshots.load(tokenHash, query);
        return {
          read_at: readAtNow(),
          data: result.data.map((row) => ({ ...row, display: displayOf(row.amount_minor, row.currency, row.value, row.unit) })),
          next_cursor: result.next_cursor,
        };
      }),
  );

  server.registerTool(
    "list_events",
    {
      title: "List timeline events",
      description:
        "The workspace timeline, newest first: deployments, payments, sync failures, alerts, and daily summaries. Filter by from (inclusive) and to (exclusive) as RFC 3339 times, type, severity, or provider. Needs the events:read scope; without usage:read, titles and bodies are withheld because they can quote amounts.",
      inputSchema: EventsQuerySchema,
      outputSchema: EventsOutputSchema,
      annotations: READ_ONLY,
    },
    (query) =>
      runTool(principal, API_ENDPOINTS.events.scope, async () => {
        const result = await API_ENDPOINTS.events.load(tokenHash, query);
        const hidden = withheldFor(
          principal,
          EVENT_TEXT_FIELDS,
          "Event titles and bodies can quote spend, for example a daily summary or a spend alert.",
        );
        return {
          read_at: readAtNow(),
          data: hidden === null ? result.data : result.data.map((row) => ({ ...row, title: null, body: null })),
          next_cursor: result.next_cursor,
          withheld: hidden,
        };
      }),
  );

  server.registerTool(
    "list_alerts",
    {
      title: "List triggered alerts",
      description:
        "Alerts that fired, newest first, with the severity the alerts page shows. acknowledged false lists only the ones nobody has acknowledged yet. Needs the alerts:read scope; without usage:read, each alert's message, threshold, and amount are withheld because a spend alert quotes money.",
      inputSchema: AlertsInputSchema,
      outputSchema: AlertsOutputSchema,
      annotations: READ_ONLY,
    },
    (query) =>
      runTool(principal, API_ENDPOINTS.triggeredAlerts.scope, async () => {
        const result = await API_ENDPOINTS.triggeredAlerts.load(tokenHash, query);
        const hidden = withheldFor(principal, ALERT_MONEY_FIELDS, "A spend or budget alert quotes the amount it measured.");
        return {
          read_at: readAtNow(),
          data: result.data.map((row) => alertItem(row, hidden !== null)),
          next_cursor: result.next_cursor,
          withheld: hidden,
        };
      }),
  );

  server.registerTool(
    "get_connection_status",
    {
      title: "Get connection status",
      description:
        "Each provider connection's status (pending, active, needs_attention, revoked, or failed) and last sync, oldest first. Credentials are never returned. Needs the connections:read scope.",
      inputSchema: PageQuerySchema,
      outputSchema: ConnectionsOutputSchema,
      annotations: READ_ONLY,
    },
    (query) =>
      runTool(principal, API_ENDPOINTS.connections.scope, async () => ({
        read_at: readAtNow(),
        ...(await API_ENDPOINTS.connections.load(tokenHash, query)),
      })),
  );

  for (const doc of providerDocs()) {
    const provider = doc.slug.at(-1) ?? doc.slug.join("-");
    server.registerResource(
      `provider-${provider}`,
      `${PROVIDER_DOC_URI_PREFIX}${provider}`,
      { title: doc.title, description: doc.description, mimeType: "text/markdown" },
      (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: doc.source }] }),
    );
  }

  return server;
}
