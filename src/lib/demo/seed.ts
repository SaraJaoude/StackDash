import "server-only";

import { parseArgs } from "node:util";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createJobDeps } from "@/lib/jobs/queue";
import { providerName } from "@/lib/providers";
import type { Database } from "@/lib/supabase/database.types";
import { workspacePath } from "@/lib/workspaces/paths";

import { DEMO_HISTORY_DAYS, historySteps, replayClock, replayHistory } from "./history";
import {
  assignDemoProjects,
  connectSimulatedProviders,
  createDemoAlerts,
  DEMO_USER_EMAIL,
  ensureDemoUser,
  markDemoAlertsSent,
  publishDemoProjectPage,
  resetDemoWorkspace,
  resolveMembers,
  type DemoConnection,
  type DemoWorkspace,
} from "./workspace";

/*
 * What `npm run demo:seed` (#166) and `npm run demo` (#260) share: their arguments, the refusal
 * check, the build of the demo workspace, and the lines they print about it with the demo
 * account's one-time sign-in link. `runDemoCommand` holds the order; the scripts wire it.
 */

type Admin = SupabaseClient<Database>;

export const DEMO_DEFAULT_SEED = "devmacro-demo";
// Progress is printed every this many replayed days.
const PROGRESS_EVERY_DAYS = 10;

// Lowercased like `npm run invite`, because auth stores emails lowercased.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export type DemoSeedArgs =
  | Readonly<{ kind: "run"; memberEmails: string[]; seed: string }>
  | Readonly<{ kind: "invalid"; message: string }>;

/** `--member <email>`, repeatable, and `--seed <text>`. Every refusal ends with `usage`. */
export function parseDemoSeedArgs(argv: readonly string[], usage: string): DemoSeedArgs {
  let values: { member: string[]; seed: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        member: { type: "string", multiple: true, default: [] },
        seed: { type: "string", default: DEMO_DEFAULT_SEED },
      },
    }));
  } catch (error) {
    // parseArgs only throws for arguments it cannot read (an unknown option, a missing value).
    return { kind: "invalid", message: `${error instanceof Error ? error.message : "The arguments could not be read."} ${usage}` };
  }
  const memberEmails: string[] = [];
  for (const member of values.member) {
    const email = emailSchema.safeParse(member);
    if (!email.success) return { kind: "invalid", message: `"${member}" is not an email address. ${usage}` };
    memberEmails.push(email.data);
  }
  if (values.seed.trim() === "") return { kind: "invalid", message: `Give --seed some text, or leave it out. ${usage}` };
  return { kind: "run", memberEmails, seed: values.seed };
}

export type SeededDemo = Readonly<{
  workspace: DemoWorkspace;
  connections: readonly DemoConnection[];
  members: ReadonlyArray<{ email: string; userId: string }>;
  /** The public project page's path. */
  pagePath: string;
}>;

/**
 * Builds the demo workspace: the demo account (once), a fresh workspace replacing the previous
 * one with the members as admins, every simulated provider connected over three projects, the
 * demo alerts, `DEMO_HISTORY_DAYS` of history replayed through the real jobs, and the public
 * project page. Members are looked up before anything is written. Progress goes to `print`.
 */
export async function seedDemoWorkspace(
  admin: Admin,
  input: Readonly<{ memberEmails: readonly string[]; seed: string; now: Date; print: (line: string) => void }>,
): Promise<SeededDemo> {
  const members = await resolveMembers(admin, input.memberEmails);
  const userId = await ensureDemoUser(admin);
  const steps = historySteps(input.now);
  const [first] = steps;
  if (first === undefined) throw new Error("The demo history has no steps.");

  const workspace = await resetDemoWorkspace(admin, userId, members);
  if (workspace.deleted > 0) input.print("Deleted the previous demo workspace.");
  const connections = await connectSimulatedProviders({ workspaceId: workspace.id, userId, seed: input.seed, now: first.at });
  await assignDemoProjects(admin, { workspaceId: workspace.id, userId, connections });
  await createDemoAlerts(admin, { workspaceId: workspace.id, userId });
  input.print(`Connected ${connections.length} simulated providers. Replaying ${DEMO_HISTORY_DAYS} days of history...`);

  await replayHistory({
    // The live job wiring, with every clock (the jobs' and the adapters') reading the replay clock.
    ...replayClock(createJobDeps(), first.at),
    workspaceId: workspace.id,
    connectionIds: connections.map((connection) => connection.id),
    steps,
    onStep: (step, index) => {
      const done = index + 1;
      if (done % PROGRESS_EVERY_DAYS === 0 || done === steps.length) {
        input.print(`  ${step.at.toISOString().slice(0, 10)} done (${done} of ${steps.length} days)`);
      }
    },
  });
  await markDemoAlertsSent(admin, { workspaceId: workspace.id, at: new Date() });

  const pagePath = await publishDemoProjectPage(admin, { workspaceId: workspace.id, workspaceSlug: workspace.slug, userId });
  return { workspace: { id: workspace.id, slug: workspace.slug }, connections, members, pagePath };
}

/** What both demo commands print once the workspace is built: what it holds, its links, and who can open it. */
export function demoSummaryLines(seeded: SeededDemo, input: Readonly<{ origin: string; signInLink: string }>): string[] {
  const { workspace, connections, members, pagePath } = seeded;
  const providers = new Intl.ListFormat("en-US", { type: "conjunction" }).format(
    connections.map((connection) => providerName(connection.provider)),
  );
  return [
    "",
    `Demo workspace ready: ${DEMO_HISTORY_DAYS} days of simulated ${providers}.`,
    `  Dashboard: ${input.origin}${workspacePath(workspace.slug, "dashboard")}`,
    `  Timeline:  ${input.origin}${workspacePath(workspace.slug, "timeline")}`,
    `  Public:    ${input.origin}${pagePath} (anyone can open it)`,
    `  Owner:     ${DEMO_USER_EMAIL}`,
    ...(members.length > 0 ? [`  Admins:    ${members.map((member) => member.email).join(", ")}`] : []),
    "",
    `Sign in as ${DEMO_USER_EMAIL} with this one-time link (it works once, within an hour, and opens the dashboard):`,
    `  ${input.signInLink}`,
    ...(members.length > 0 ? ["The admins can also sign in with GitHub."] : []),
  ];
}

export type DemoCommand = Readonly<{
  /** Starts the refusal message: "Demo" or "Demo seed". */
  label: string;
  usage: string;
  /** `demoCommandRefusal` for this process: why it must not run here, or null. */
  refusal: () => string | null;
  seed: (input: Readonly<{ memberEmails: readonly string[]; seed: string }>) => Promise<SeededDemo>;
  /** The demo account's one-time sign-in link (`demoSignInLink`) landing on `next`. */
  signInLink: (next: string) => Promise<string>;
  origin: string;
  print: (line: string) => void;
  printError: (line: string) => void;
  /** Runs once the summary is printed: the live watch for `npm run demo`, a hint for the seed. */
  afterSummary: () => Promise<void>;
}>;

/**
 * A demo command from its arguments to its exit code: arguments, then the refusal (nothing is
 * read or written before it), then the seed, the sign-in link to the dashboard, the summary, and
 * `afterSummary` last, so the watch starts only on the finished history. 2 for a refusal.
 */
export async function runDemoCommand(argv: readonly string[], command: DemoCommand): Promise<number> {
  const args = parseDemoSeedArgs(argv, command.usage);
  if (args.kind === "invalid") {
    command.printError(args.message);
    return 2;
  }
  const refusal = command.refusal();
  if (refusal !== null) {
    command.printError(`${command.label} refused. ${refusal}`);
    return 2;
  }
  const seeded = await command.seed({ memberEmails: args.memberEmails, seed: args.seed });
  const signInLink = await command.signInLink(workspacePath(seeded.workspace.slug, "dashboard"));
  for (const line of demoSummaryLines(seeded, { origin: command.origin, signInLink })) command.print(line);
  await command.afterSummary();
  return 0;
}
