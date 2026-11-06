import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log/logger";
import { fakeSupabase, MAX_ROWS } from "@/lib/supabase/fake-postgrest";

import { getDeliveryDestination, listDeliveryDestinations, listDestinations, RULE_LINKS_LIMIT } from "./notification-destinations";

/*
 * The rule links each channel receives, against a fake PostgREST that, like the real one, answers
 * at most max_rows (1000) rows a request and says nothing about the rest (#218). A link left out
 * shows its rule as unlinked on the settings page and keeps the rule's alerts from the channel.
 * The member read (listDestinations) and the service role reads go through the same fake.
 */

const { client } = vi.hoisted(() => ({ client: { db: null as unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client.db }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client.db }));

const WORKSPACE_ID = "21800000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "21800000-0000-4000-8000-000000000002";

function uuid(prefix: number, index: number): string {
  return `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function destination(index: number, workspaceId = WORKSPACE_ID) {
  return {
    id: uuid(21820, index),
    workspace_id: workspaceId,
    kind: "slack",
    name: `Channel ${index}`,
    url_host: "hooks.slack.com",
    all_rules: false,
    digest: "off",
    status: "active",
    consecutive_failures: 0,
    last_error_code: null,
    last_error_reference: null,
    last_delivered_at: null,
    created_at: `2026-11-${String(index + 1).padStart(2, "0")}T09:00:00+00:00`,
  };
}

/** `rulesEach` links for each of `destinationCount` channels, plus one channel of another workspace. */
function workspace(destinationCount: number, rulesEach: number) {
  const destinations = Array.from({ length: destinationCount }, (_, index) => destination(index));
  const ruleIds = Array.from({ length: rulesEach }, (_, index) => uuid(21821, index));
  const links = destinations.flatMap((row) => ruleIds.map((ruleId) => ({ workspace_id: WORKSPACE_ID, destination_id: row.id, rule_id: ruleId })));
  const other = destination(9, OTHER_WORKSPACE_ID);
  const otherLinks = [{ workspace_id: OTHER_WORKSPACE_ID, destination_id: other.id, rule_id: uuid(21822, 0) }];
  const fake = fakeSupabase({
    notification_destinations: [other, ...destinations],
    alert_rule_destinations: [...otherLinks, ...links].toReversed(),
  });
  client.db = fake.db;
  const linkReads = () => fake.requests.filter((request) => request.table === "alert_rule_destinations");
  return { destinations, ruleIds, linkReads };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rule links read in pages (boundary: more links than max_rows)", () => {
  it("gives every channel on the settings page all of its rules", async () => {
    // 3 channels with 400 rules each: 1200 links.
    const { destinations, ruleIds, linkReads } = workspace(3, 400);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const rows = await listDestinations(WORKSPACE_ID);

    expect(rows.map((row) => [row.id, row.rule_ids])).toEqual(destinations.map((row) => [row.id, ruleIds]));
    expect(linkReads()).toHaveLength(2);
    expect(linkReads().every((request) => request.limit !== null && request.limit <= MAX_ROWS)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives every channel the senders see all of its rules", async () => {
    const { destinations, ruleIds, linkReads } = workspace(3, 400);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const rows = await listDeliveryDestinations(WORKSPACE_ID);

    expect(rows.map((row) => [row.id, row.ruleIds])).toEqual(destinations.map((row) => [row.id, new Set(ruleIds)]));
    expect(linkReads()).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives one channel all of its rules and none of another channel's", async () => {
    // 2 channels with 1100 rules each: one channel's links alone pass max_rows.
    const { destinations, ruleIds, linkReads } = workspace(2, 1100);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const id = destinations[1]?.id ?? "";

    const row = await getDeliveryDestination(WORKSPACE_ID, id);

    expect(row?.ruleIds).toEqual(new Set(ruleIds));
    expect(linkReads()).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("rule links bound", () => {
  it("stops at RULE_LINKS_LIMIT and logs the cut (boundary: more links than the bound)", async () => {
    // 2 channels with 2600 rules each: 5200 links.
    const { linkReads } = workspace(2, 2600);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const rows = await listDeliveryDestinations(WORKSPACE_ID);

    expect(rows.reduce((total, row) => total + row.ruleIds.size, 0)).toBe(RULE_LINKS_LIMIT);
    expect(linkReads()).toHaveLength(RULE_LINKS_LIMIT / MAX_ROWS);
    expect(warn).toHaveBeenCalledExactlyOnceWith("notification_destinations.rule_links_truncated", {
      workspaceId: WORKSPACE_ID,
      destinationId: null,
      rows: RULE_LINKS_LIMIT,
    });
  });
});
