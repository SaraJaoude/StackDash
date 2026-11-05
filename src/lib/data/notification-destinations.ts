import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { decryptSecret, DecryptionFailedError, encryptSecret, UnknownEncryptionKeyError } from "@/lib/crypto/credentials";
import { encryptedFromRow, encryptedToColumns } from "@/lib/data/credentials";
import type { ChannelSecret } from "@/lib/notifications/channels";
import type { DeliveryDestination, DestinationKind, DigestFrequency } from "@/lib/notifications/model";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables, TablesUpdate } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * Repository for alert channels (#153): `notification_destinations`, the sealed URL in
 * `notification_destination_secrets` (service role only, like connection credentials, #35), and
 * the rule links in `alert_rule_destinations`.
 *
 * Reads and edits that a member makes go through the signed-in client, so row level security
 * repeats the role check. Creating a channel writes the row and its sealed URL in one transaction
 * through `create_notification_destination`, as the service role, after the caller authorized the
 * user as an admin. The URL and the signing secret never leave this module except decrypted for a
 * send, and are never logged: errors carry the Postgres code only.
 */

export type DestinationRow = Pick<
  Tables<"notification_destinations">,
  | "id"
  | "kind"
  | "name"
  | "url_host"
  | "all_rules"
  | "digest"
  | "status"
  | "consecutive_failures"
  | "last_error_code"
  | "last_error_reference"
  | "last_delivered_at"
  | "created_at"
> & { rule_ids: string[] };

const DESTINATION_COLUMNS =
  "id, kind, name, url_host, all_rules, digest, status, consecutive_failures, last_error_code, last_error_reference, last_delivered_at, created_at";

// A workspace has a handful of channels; rules are bounded the same way the alert evaluation bounds them.
export const DESTINATIONS_LIMIT = 50;
const RULE_LINKS_LIMIT = 5000;

function failure(operation: string, error: { code: string }): Error {
  return new Error(`notification destinations ${operation} failed (code ${error.code}).`);
}

/** Associated data that binds a sealed URL to its row. */
export function destinationSecretAad(workspaceId: string, destinationId: string): string {
  return `notification_destination:${workspaceId}:${destinationId}`;
}

// Versioned like the credential shape, so a later change is migrated rather than misread.
const secretSchema = z
  .object({ v: z.literal(1), url: z.url(), signingSecret: z.string().min(1).optional() })
  .strict();

function linksByDestination(links: ReadonlyArray<{ destination_id: string; rule_id: string }>): Map<string, string[]> {
  const byDestination = new Map<string, string[]>();
  for (const link of links) {
    const list = byDestination.get(link.destination_id);
    if (list === undefined) byDestination.set(link.destination_id, [link.rule_id]);
    else list.push(link.rule_id);
  }
  return byDestination;
}

/** The workspace's channels, oldest first, with the rules each one receives. */
export async function listDestinations(workspaceId: string): Promise<DestinationRow[]> {
  const supabase = await createClient();
  const [destinations, links] = await Promise.all([
    supabase
      .from("notification_destinations")
      .select(DESTINATION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(DESTINATIONS_LIMIT),
    supabase
      .from("alert_rule_destinations")
      .select("destination_id, rule_id")
      .eq("workspace_id", workspaceId)
      .order("destination_id")
      .limit(RULE_LINKS_LIMIT),
  ]);
  if (destinations.error) throw failure("list", destinations.error);
  if (links.error) throw failure("list rule links", links.error);
  const rules = linksByDestination(links.data);
  return destinations.data.map((row) => ({ ...row, rule_ids: rules.get(row.id) ?? [] }));
}

export type NewDestination = Readonly<{
  workspaceId: string;
  userId: string;
  kind: DestinationKind;
  name: string;
  url: string;
  host: string;
  allRules: boolean;
  ruleIds: readonly string[];
  digest: DigestFrequency;
  signingSecret?: string;
}>;

/** Seals the URL and writes the channel. The caller has authorized the user as an admin of the workspace. */
export async function createDestination(input: NewDestination): Promise<string> {
  const id = randomUUID();
  const plaintext = JSON.stringify({
    v: 1,
    url: input.url,
    ...(input.signingSecret === undefined ? {} : { signingSecret: input.signingSecret }),
  });
  const sealed = encryptedToColumns(encryptSecret(plaintext, destinationSecretAad(input.workspaceId, id)));
  const { error } = await createAdminClient().rpc("create_notification_destination", {
    p_id: id,
    p_workspace_id: input.workspaceId,
    p_kind: input.kind,
    p_name: input.name,
    p_url_host: input.host,
    p_all_rules: input.allRules,
    p_digest: input.digest,
    p_rule_ids: [...input.ruleIds],
    p_key_id: sealed.key_id,
    p_iv: sealed.iv,
    p_ciphertext: sealed.ciphertext,
    p_auth_tag: sealed.auth_tag,
    p_created_by: input.userId,
  });
  if (error) throw failure("create", error);
  return id;
}

export type DestinationSettings = Readonly<{ name: string; allRules: boolean; ruleIds: readonly string[]; digest: DigestFrequency }>;

/**
 * Renames a channel and sets what it receives. False when no channel with `id` is in the workspace
 * (or row level security refused it). The rule links are replaced after the row, so a failure
 * between the two leaves the old selection, never a channel that receives more than it did.
 */
export async function updateDestination(workspaceId: string, id: string, settings: DestinationSettings): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_destinations")
    .update({ name: settings.name, all_rules: settings.allRules, digest: settings.digest })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw failure("update", error);
  if (data.length === 0) return false;

  const keep = settings.allRules ? [] : [...new Set(settings.ruleIds)];
  let removal = supabase.from("alert_rule_destinations").delete().eq("workspace_id", workspaceId).eq("destination_id", id);
  if (keep.length > 0) removal = removal.not("rule_id", "in", `(${keep.join(",")})`);
  const removed = await removal;
  if (removed.error) throw failure("unlink rules", removed.error);
  if (keep.length > 0) {
    const added = await supabase
      .from("alert_rule_destinations")
      .upsert(
        keep.map((ruleId) => ({ workspace_id: workspaceId, destination_id: id, rule_id: ruleId })),
        { onConflict: "destination_id,rule_id", ignoreDuplicates: true },
      );
    if (added.error) throw failure("link rules", added.error);
  }
  return true;
}

/** Deletes a channel and, by cascade, its sealed URL, rule links, and delivery records. */
export async function deleteDestination(workspaceId: string, id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_destinations")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw failure("delete", error);
  return data.length > 0;
}

/**
 * The decrypted URL (and signing secret) of a channel, or null when it has none or it cannot be
 * read: the key is not configured or the record fails authentication, so the channel needs a new
 * URL. Service role. Only the send paths may call this, and never log the result.
 */
export async function loadDestinationSecret(workspaceId: string, destinationId: string): Promise<ChannelSecret | null> {
  const { data, error } = await createAdminClient()
    .from("notification_destination_secrets")
    .select("key_id, iv, ciphertext, auth_tag")
    .eq("workspace_id", workspaceId)
    .eq("destination_id", destinationId)
    .maybeSingle();
  if (error) throw failure("secret read", error);
  if (data === null) return null;
  let plaintext: string;
  try {
    plaintext = decryptSecret(encryptedFromRow(data), destinationSecretAad(workspaceId, destinationId));
  } catch (decryptError) {
    if (decryptError instanceof UnknownEncryptionKeyError || decryptError instanceof DecryptionFailedError) return null;
    throw decryptError;
  }
  const parsed = secretSchema.safeParse(JSON.parse(plaintext));
  // Only that the shape is wrong: zod issues would echo the URL.
  if (!parsed.success) throw new Error("Decrypted channel secret has an unexpected shape.");
  return parsed.data.signingSecret === undefined
    ? { url: parsed.data.url }
    : { url: parsed.data.url, signingSecret: parsed.data.signingSecret };
}

/** One channel as the senders need it. Service role; the caller has authorized the user. */
export async function getDeliveryDestination(workspaceId: string, destinationId: string): Promise<DeliveryDestination | null> {
  const db = createAdminClient();
  const [destination, links] = await Promise.all([
    db
      .from("notification_destinations")
      .select("id, kind, name, all_rules, digest, status, consecutive_failures")
      .eq("workspace_id", workspaceId)
      .eq("id", destinationId)
      .maybeSingle(),
    db.from("alert_rule_destinations").select("rule_id").eq("workspace_id", workspaceId).eq("destination_id", destinationId).limit(RULE_LINKS_LIMIT),
  ]);
  if (destination.error) throw failure("read", destination.error);
  if (links.error) throw failure("read rule links", links.error);
  if (destination.data === null) return null;
  return toDeliveryDestination(destination.data, links.data.map((link) => link.rule_id));
}

export function toDeliveryDestination(
  row: Pick<Tables<"notification_destinations">, "id" | "kind" | "name" | "all_rules" | "digest" | "status" | "consecutive_failures">,
  ruleIds: readonly string[],
): DeliveryDestination {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    allRules: row.all_rules,
    ruleIds: new Set(ruleIds),
    digest: row.digest,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
  };
}

/** Every channel of a workspace as the senders need it. Service role. */
export async function listDeliveryDestinations(workspaceId: string): Promise<DeliveryDestination[]> {
  const db = createAdminClient();
  const [destinations, links] = await Promise.all([
    db
      .from("notification_destinations")
      .select("id, kind, name, all_rules, digest, status, consecutive_failures")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(DESTINATIONS_LIMIT),
    db.from("alert_rule_destinations").select("destination_id, rule_id").eq("workspace_id", workspaceId).order("destination_id").limit(RULE_LINKS_LIMIT),
  ]);
  if (destinations.error) throw failure("list for delivery", destinations.error);
  if (links.error) throw failure("list rule links for delivery", links.error);
  const rules = linksByDestination(links.data);
  return destinations.data.map((row) => toDeliveryDestination(row, rules.get(row.id) ?? []));
}

export type HealthPatch = Pick<
  TablesUpdate<"notification_destinations">,
  "status" | "consecutive_failures" | "last_error_code" | "last_error_reference" | "last_delivered_at"
>;

/** Records a delivery's outcome on the channel. Service role: status and errors are server-written. */
export async function updateDestinationHealth(workspaceId: string, destinationId: string, patch: HealthPatch): Promise<void> {
  const { error } = await createAdminClient()
    .from("notification_destinations")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", destinationId);
  if (error) throw failure("health update", error);
}
