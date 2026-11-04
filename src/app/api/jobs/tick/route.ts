import { NextResponse } from "next/server";

import { log, logError } from "@/lib/log/logger";
import { createJobDeps } from "@/lib/jobs/queue";
import { isAuthorizedCronRequest, runTick } from "@/lib/jobs/runner";

/*
 * POST /api/jobs/tick (#10, #44). Called every minute by pg_cron through pg_net (hosted and
 * self-hosted), or by `npm run jobs:tick` locally. See docs/operations/jobs.md.
 * POST handlers are never cached, so every call runs. The response carries counts only.
 */

// Headroom over the runner's 50 s budget for jobs already running when it ends.
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<NextResponse> {
  // Read per request so the secret is never baked into a build.
  const secret = process.env.CRON_SECRET;
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    if (secret === undefined || secret.length === 0) log.error("jobs.tick.cron_secret_missing");
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const result = await runTick(createJobDeps());
    log.info("jobs.tick.finished", result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const referenceId = logError("jobs.tick.failed", error);
    return NextResponse.json({ error: "tick_failed", referenceId }, { status: 500, headers: NO_STORE });
  }
}
