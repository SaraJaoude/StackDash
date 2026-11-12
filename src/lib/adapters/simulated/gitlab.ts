import type { ActivityEvent } from "@/lib/adapters/events";
import {
  deploymentEvent,
  gitlabAdapter,
  mergeRequestEvent,
  pipelineEvent,
  releaseEvent,
  usageMetrics,
  type ProjectRef,
} from "@/lib/adapters/gitlab";
import type { AdapterMetric } from "@/lib/adapters/metrics";

import {
  accrued,
  between,
  chance,
  countOf,
  HOUR_MS,
  instantInSlot,
  simulatedEndpoint,
  SLOT_MS,
  unit,
  utcMonthStart,
  type SimulatedProfile,
} from "./simulation";

/*
 * Simulated GitLab group on the Free plan: compute minutes accrue hour by hour and pass 75 and
 * then 90 percent of the 400 minute quota late in the month, storage grows slowly, and about 90
 * pipelines, 15 merged merge requests, 10 deployments, and one release land a day. Events go
 * through the real adapter's builders, so titles, severities, and dedupe keys match a real sync.
 */

const PLAN = "free";
const GROUP = "example-group";
const PROJECTS = [
  { id: 1001, name: "web", defaultBranch: "main" },
  { id: 1002, name: "api", defaultBranch: "main" },
  { id: 1003, name: "docs", defaultBranch: "main" },
] as const;
const BRANCHES = ["main", "feature/checkout", "fix/login-redirect", "chore/deps"] as const;
// Each environment with the branch it deploys, so an event never names one branch's review app
// beside another branch's ref (#264).
const ENVIRONMENTS = [
  { name: "production", ref: "main" },
  { name: "staging", ref: "main" },
  { name: "review/feature-checkout", ref: "feature/checkout" },
] as const;
const BYTES_PER_GIB = 2 ** 30;
// 10 GiB, the Free plan's storage figure on the pricing page.
const STORAGE_LIMIT_BYTES = 10 * BYTES_PER_GIB;
const ENDPOINT = simulatedEndpoint("gitlab", "/api/graphql");

function projectRef(accountId: string, index: number): ProjectRef {
  const project = PROJECTS[index] ?? PROJECTS[0];
  return {
    // Offset by the account so two simulated connections never share project ids.
    id: project.id + between(0, 899, accountId, "project-offset") * 10,
    path_with_namespace: `${GROUP}/${project.name}`,
    default_branch: project.defaultBranch,
  };
}

// Hundredths of a minute per hour and project. About 0.55 minutes an hour across the group, so the
// 400 minute quota passes 75 percent around the 23rd and 90 percent around the 27th.
const PROJECT_SHARES = [0.5, 0.35, 0.15] as const;

function metrics(accountId: string, at: Date): AdapterMetric[] {
  const monthStartMs = utcMonthStart(at).getTime();
  const projectMinutes = PROJECTS.map((project, index) => {
    const share = PROJECT_SHARES[index] ?? 0;
    const perHour = (hourStartMs: number) => Math.round(share * between(30, 80, accountId, "minutes", index, hourStartMs));
    return {
      projectId: projectRef(accountId, index).id,
      fullPath: `${GROUP}/${project.name}`,
      minutes: Math.floor(accrued(monthStartMs, at.getTime(), perHour) / 100),
    };
  });
  // Storage grows about 20 MiB a day from 2.4 GiB at the start of each month.
  const days = (at.getTime() - monthStartMs) / (24 * HOUR_MS);
  const storageBytes = Math.round(2.4 * BYTES_PER_GIB + days * 20 * 2 ** 20);
  return usageMetrics(
    {
      plan: PLAN,
      minutesUsed: projectMinutes.reduce((sum, project) => sum + project.minutes, 0),
      projectMinutes,
      storageBytes,
      storageLimitBytes: STORAGE_LIMIT_BYTES,
    },
    accountId,
    at,
    ENDPOINT,
  );
}

function eventsInSlot(accountId: string, slot: number): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const push = (event: ActivityEvent | undefined) => {
    if (event !== undefined) events.push(event);
  };
  const slotEnd = new Date((slot + 1) * SLOT_MS);

  // About 90 finished pipelines a day (8,640 slots).
  const pipelines = countOf([0.008, 0.002], accountId, "pipelines", slot);
  for (let index = 0; index < pipelines; index += 1) {
    const parts = [accountId, "pipeline", slot, index] as const;
    const projectIndex = between(0, PROJECTS.length - 1, ...parts, "project");
    const project = projectRef(accountId, projectIndex);
    const id = slot * 10 + index;
    push(
      pipelineEvent(
        project,
        {
          id,
          iid: (id % 100_000) + 1,
          status: chance(0.12, ...parts, "failed") ? "failed" : "success",
          ref: BRANCHES[between(0, BRANCHES.length - 1, ...parts, "ref")] ?? "main",
          // A link to a pipeline that never existed would mislead, so the simulator has none.
          web_url: "",
          updated_at: instantInSlot(slot, ...parts),
        },
        accountId,
      ),
    );
  }

  // About 15 merged merge requests a day.
  if (chance(0.0017, accountId, "merge-request", slot)) {
    const project = projectRef(accountId, between(0, PROJECTS.length - 1, accountId, "merge-request-project", slot));
    push(
      mergeRequestEvent(
        project,
        { iid: (slot % 10_000) + 1, state: "merged", merged_at: instantInSlot(slot, accountId, "merged"), web_url: "" },
        accountId,
      ),
    );
  }

  // About 10 deployments a day, mostly to staging and review apps.
  if (chance(0.0012, accountId, "deployment", slot)) {
    const parts = [accountId, "deployment", slot] as const;
    const index = between(0, ENVIRONMENTS.length - 1, ...parts, "environment");
    const environment = ENVIRONMENTS[index] ?? ENVIRONMENTS[1];
    push(
      deploymentEvent(
        projectRef(accountId, 0),
        {
          id: slot,
          iid: (slot % 100_000) + 1,
          status: chance(0.1, ...parts, "failed") ? "failed" : "success",
          ref: environment.ref,
          updated_at: instantInSlot(slot, ...parts),
          environment: { id: index + 1, name: environment.name },
        },
        accountId,
      ),
    );
  }

  // About one release a day.
  if (chance(0.00012, accountId, "release", slot)) {
    const minor = Math.floor(unit(accountId, "release-version", slot) * 50);
    push(
      releaseEvent(
        projectRef(accountId, 1),
        {
          tag_name: `v1.${minor}.${slot % 10}`,
          released_at: instantInSlot(slot, accountId, "released"),
          // No link: a release page that never existed would mislead.
        },
        accountId,
        slotEnd,
      ),
    );
  }

  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

export const gitlabProfile: SimulatedProfile = {
  real: gitlabAdapter,
  accounts: (seed) => [{ externalId: String(parseInt(seed, 16)), displayName: GROUP, kind: "group" }],
  metrics,
  eventsInSlot,
};
