/*
 * Builds a ready-to-demo workspace on the local Supabase stack (#166): a demo account owning one
 * workspace with every simulated provider connected, its accounts spread over three projects, a
 * Vercel budget and a Resend quota alert, and 90 days of history replayed through the real sync,
 * alert, and daily summary jobs.
 *
 *   npm run demo:seed
 *   npm run demo:seed -- --member you@example.com [--member someone@example.com] [--seed <text>]
 *
 * Sign-in is GitHub only, so the demo account itself has no sign-in: `--member` adds an account
 * that has signed in with GitHub before as an admin of the demo workspace. `--seed` picks the
 * simulated accounts, so the same seed rehearses the same demo (default "devmacro-demo").
 *
 * Refuses to run unless DEVMACRO_SIMULATE_PROVIDERS=1 and NEXT_PUBLIC_SUPABASE_URL points at this
 * computer. Rerunning replaces the demo workspace; nothing outside it is touched. Stop
 * `npm run jobs:tick -- --watch` while it runs, then start it again to continue the history live.
 * Reads `.env.local` when present.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { z } from "zod";

import { isProviderSimulationEnabled } from "@/lib/adapters/simulated";
import { connectOrigin } from "@/lib/connections/oauth-state";
import { DEMO_HISTORY_DAYS, demoSeedRefusal, historySteps, replayHistory } from "@/lib/demo/history";
import {
  assignDemoProjects,
  connectSimulatedProviders,
  createDemoAlerts,
  DEMO_USER_EMAIL,
  ensureDemoUser,
  resetDemoWorkspace,
  resolveMembers,
} from "@/lib/demo/workspace";
import { createJobDeps } from "@/lib/jobs/queue";
import type { SyncDeps } from "@/lib/jobs/sync-connection";
import { providerName } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

/** `workspacePath` from src/lib/workspaces/access.ts, which pulls in Next.js and cannot load in a script. */
function workspaceUrl(origin: string, slug: string, section: "dashboard" | "timeline"): string {
  return `${origin}/w/${slug}/${section}`;
}

const USAGE = "Usage: npm run demo:seed -- [--member you@example.com] [--seed <text>]";
const DEFAULT_SEED = "devmacro-demo";
const DEFAULT_ORIGIN = "http://localhost:3000";
// Progress is printed every this many replayed days.
const PROGRESS_EVERY_DAYS = 10;

// Lowercased like `npm run invite`, because auth stores emails lowercased.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

async function main(): Promise<number> {
  let values: { member: string[]; seed: string };
  try {
    ({ values } = parseArgs({
      options: {
        member: { type: "string", multiple: true, default: [] },
        seed: { type: "string", default: DEFAULT_SEED },
      },
    }));
  } catch (error) {
    // parseArgs only throws for arguments it cannot read (an unknown option, a missing value).
    console.error(error instanceof Error ? error.message : "The arguments could not be read.");
    console.error(USAGE);
    return 2;
  }
  const emails = values.member.map((member) => emailSchema.safeParse(member));
  const invalid = emails.findIndex((email) => !email.success);
  if (invalid !== -1) {
    console.error(`"${values.member[invalid]}" is not an email address. ${USAGE}`);
    return 2;
  }
  if (values.seed.trim() === "") {
    console.error(`Give --seed some text, or leave it out. ${USAGE}`);
    return 2;
  }

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const refusal = demoSeedRefusal({
    simulationEnabled: isProviderSimulationEnabled(),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (refusal !== null) {
    console.error(`Demo seed refused. ${refusal}`);
    return 2;
  }

  const admin = createAdminClient();
  const members = await resolveMembers(admin, emails.flatMap((email) => (email.success ? [email.data] : [])));
  const userId = await ensureDemoUser(admin);
  const steps = historySteps(new Date());
  const [first] = steps;
  if (first === undefined) throw new Error("The demo history has no steps.");

  const workspace = await resetDemoWorkspace(admin, userId, members);
  if (workspace.deleted > 0) console.log("Deleted the previous demo workspace.");
  const connections = await connectSimulatedProviders({ workspaceId: workspace.id, userId, seed: values.seed, now: first.at });
  await assignDemoProjects(admin, { workspaceId: workspace.id, userId, connections });
  await createDemoAlerts(admin, { workspaceId: workspace.id, userId });
  console.log(`Connected ${connections.length} simulated providers. Replaying ${DEMO_HISTORY_DAYS} days of history...`);

  // The live job wiring, with every clock (the jobs' and the adapters') reading the replay clock.
  let clock = first.at;
  const live = createJobDeps();
  const deps: SyncDeps = {
    ...live,
    now: () => clock,
    createOAuthContext: (client) => ({ ...live.createOAuthContext(client), now: () => clock }),
  };
  await replayHistory({
    deps,
    setNow: (at) => {
      clock = at;
    },
    workspaceId: workspace.id,
    connectionIds: connections.map((connection) => connection.id),
    steps,
    onStep: (step, index) => {
      const done = index + 1;
      if (done % PROGRESS_EVERY_DAYS === 0 || done === steps.length) {
        console.log(`  ${step.at.toISOString().slice(0, 10)} done (${done} of ${steps.length} days)`);
      }
    },
  });

  const origin = connectOrigin(DEFAULT_ORIGIN, process.env.NEXT_PUBLIC_SITE_URL);
  const providers = new Intl.ListFormat("en-US", { type: "conjunction" }).format(
    connections.map((connection) => providerName(connection.provider)),
  );
  console.log("");
  console.log(`Demo workspace ready: ${DEMO_HISTORY_DAYS} days of simulated ${providers}.`);
  console.log(`  Dashboard: ${workspaceUrl(origin, workspace.slug, "dashboard")}`);
  console.log(`  Timeline:  ${workspaceUrl(origin, workspace.slug, "timeline")}`);
  console.log(`  Owner:     ${DEMO_USER_EMAIL} (made by the demo seed, has no sign-in)`);
  if (members.length > 0) {
    console.log(`  Admins:    ${members.map((member) => member.email).join(", ")}`);
    console.log(`Sign in at ${origin}/sign-in with GitHub as one of the admins, then open the dashboard.`);
  } else {
    console.log("Nobody can open it yet. Sign in once with GitHub, then add yourself:");
    console.log("  npm run demo:seed -- --member you@example.com");
  }
  console.log("Keep the history going live with: npm run jobs:tick -- --watch");
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Errors raised on this path carry Postgres codes and messages, never secrets.
    console.error(error instanceof Error && error.message.length > 0 ? `Demo seed failed: ${error.message}` : "Demo seed failed.");
    process.exitCode = 1;
  },
);
