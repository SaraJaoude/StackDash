/*
 * Runs one job tick locally: schedules due syncs and the daily retention job, then runs up to 10
 * claimed jobs, exactly as POST /api/jobs/tick does.
 *
 *   npm run jobs:tick
 *
 * Calls the runner directly, so no dev server or CRON_SECRET is needed. Reads `.env.local` when
 * present (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEVMACRO_ENCRYPTION_KEY, provider
 * OAuth settings). Prints the counts only. See docs/operations/jobs.md.
 */
import { existsSync } from "node:fs";

import { createJobDeps } from "@/lib/jobs/queue";
import { runTick } from "@/lib/jobs/runner";

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const result = await runTick(createJobDeps());
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  // Store errors carry Postgres codes only, never row data or secrets.
  console.error(error instanceof Error && error.message.length > 0 ? `Tick failed: ${error.message}` : "Tick failed.");
  process.exitCode = 1;
});
