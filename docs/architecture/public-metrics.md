# Public metrics

Issues: #148, epic #147. The numbers a workspace can choose to make public, how each one is counted, and how the rest of DevMacro reads them. Badges, cards, public project pages, the weekly email, and the leaderboard all read published values through one engine, so every surface shows the same number with the same label.

## Rules

- Nothing is public until an owner or admin publishes it, one metric per project at a time. Viewers see what is published and nothing more.
- Values come only from stored snapshots and events, never from a provider call on request.
- Spend, budgets, alert thresholds, revenue, and any amount of money have no metric id, so they cannot be published. The database enum `public_metric_id` is the only list of publishable ids.
- No account names, repository names, emails, keys, or infrastructure details appear in a published value or its label.
- Every value carries its provenance (Verified, Estimated, or Self-reported), the time of the sync it rests on, and a link to its formula on this page.
- A value made up by the provider simulator is marked simulated, and a surface must say so rather than show it as verified.

### Provenance

| Label | Meaning | Where it may appear |
|---|---|---|
| Verified | Counted from what the provider reported | Every surface |
| Estimated | Calculated by DevMacro | Every surface, labelled Estimated |
| Self-reported | Typed by a person on the public metrics page | The project page only, labelled Self-reported. Never on a badge, a card that claims Verified, or a leaderboard |

Every metric in the first set below is Verified.

### When there is no number

A metric that cannot be computed honestly says why instead of showing a number:

| Reason | Shown as | When |
|---|---|---|
| `not_connected` | Not connected | The project has no included account of the metric's provider |
| `no_data` | No data yet | Connected, but nothing is stored yet, or the provider does not report it for this account |
| `not_enough_history` | Not enough history yet | Stored data does not cover the whole window, for example a 30 day count from 3 days of data |
| `stale` | Not synced in the last 2 days | The newest data behind the value is more than 48 hours old, or an account has never synced |

Partial data always understates, never overstates: an account added in the middle of a window adds only what it saw, and a missing start-of-window reading is replaced by the next day's (a shorter window), never an earlier one.

### Rounding and delay

Each publication chooses how the value is shown:

- Rounding: exact, or rounded down to 10, 100, or 1,000. Always down, so a public number never claims more than the stored data shows; a rounded value reads "at least 1,200 stars". A percent rounds to 10 at most.
- Timing: the current value, or the value as it was 7 days ago. A delayed value only uses rows retrieved and events that occurred up to that moment.

Changing either option revokes the publication and publishes a new one, so the history shows what was public when.

## Publishing and the audit trail

Owners and admins publish on a project's public metrics page (Projects, then Public metrics). Every change writes a DevMacro event to the workspace timeline in the same transaction:

| Event type | Title |
|---|---|
| `devmacro.metric_published` | Published GitHub stars |
| `devmacro.metric_unpublished` | Unpublished GitHub stars |
| `devmacro.metrics_unpublished_all` | Unpublished everything |

"Unpublish everything" revokes every live publication of every project in the workspace in one action. Deleting an account removes every publication its user made, and deleting a workspace or a project removes theirs. The schema, row level security, and functions are in [Database schema](schema.md#public-metrics-148).

## Reading published values

### Public route

`GET /api/public/projects/<project id>/metrics` returns a project's live publications as JSON, for anyone. A project that does not exist and one with nothing published both answer `404`, so the route never reveals which projects exist. Responses are cached for 60 seconds (`Cache-Control: public, max-age=60, s-maxage=60`), so an unpublished value stops showing within a minute.

```json
{
  "projectId": "30000000-0000-4000-8000-000000000001",
  "metrics": [
    {
      "kind": "engine",
      "id": "github-stars",
      "label": "GitHub stars",
      "provenance": "verified",
      "unit": "stars",
      "formulaUrl": "/docs/architecture/public-metrics#github-stars",
      "rounding": "hundreds",
      "delayDays": 0,
      "asOf": "2026-11-05T12:00:00.000Z",
      "publishedAt": "2026-11-05T11:00:00.000Z",
      "status": "available",
      "value": 1200,
      "atLeast": true,
      "text": "at least 1,200 stars",
      "lastSyncedAt": "2026-11-05T11:55:00.000Z",
      "simulated": false
    },
    {
      "kind": "self_reported",
      "label": "Downloads this month",
      "provenance": "self_reported",
      "value": 4200,
      "unit": "downloads",
      "text": "4,200 downloads",
      "publishedAt": "2026-11-05T11:00:00.000Z"
    }
  ]
}
```

An engine metric with no number has `"status": "unavailable"`, a `reason` from the table above, and `text`, and no `value`.

### Server API

Server code (badges and cards #149, project pages #150, the yearly card #151, the leaderboard) reads published values through `src/lib/public-metrics/published.ts` and never queries `published_metrics` itself:

| Function | Returns |
|---|---|
| `loadPublishedProjectMetrics(projectId, now)` | Every live publication of the project, engine metrics in definition order then self-reported values, or `null` when nothing is published |
| `loadPublishedMetric(projectId, metricId, now)` | One published engine metric, or `null`. It takes a `PublicMetricId`, so a self-reported value can never become a badge |

Both read live rows through `public_published_metrics()` with the service role and compute each value at its own delay. A leaderboard keeps only `provenance === "verified"` values that are not `simulated`. `src/lib/public-metrics/definitions.ts` holds the definitions (`PUBLIC_METRICS`, `publicMetricDefinition`, `formulaPath`), `engine.ts` computes from any `PublicMetricStore`, and `display.ts` formats values and summaries without touching data, so client components can use it.

## Metrics

Each metric below is defined once in `src/lib/public-metrics/definitions.ts`. The heading is the metric id, used in the public route, badge URLs, and links to this page.

### `github-stars`

GitHub stars. Verified, in stars. Snapshots: `github.stars.total`. Minimum history: none.

Stars across the repositories the project's GitHub accounts can see, from the newest hourly star count. Repository names are never shown.

### `github-stars-gained-7d`

GitHub stars gained in 7 days. Verified, in stars. Snapshots: `github.stars.total`. Minimum history: 7 days.

The newest star count minus the star count at the end of the day 7 days ago, per GitHub account, added up. Unstars count against it, and it never goes below zero.

### `github-stars-gained-30d`

GitHub stars gained in 30 days. Verified, in stars. Snapshots: `github.stars.total`. Minimum history: 30 days.

The newest star count minus the star count at the end of the day 30 days ago, per GitHub account, added up. Unstars count against it, and it never goes below zero.

### `vercel-deployments-7d`

Deployments in 7 days. Verified, in deployments. Events: `vercel.deployment.succeeded`. Minimum history: 7 days.

Vercel deployments that finished successfully in the last 7 days, one per deployment. Counts deployments to every environment (production and preview) until DevMacro records the environment of each deployment (#155).

### `vercel-deployments-30d`

Deployments in 30 days. Verified, in deployments. Events: `vercel.deployment.succeeded`. Minimum history: 30 days.

Vercel deployments that finished successfully in the last 30 days, one per deployment. Counts deployments to every environment (production and preview) until DevMacro records the environment of each deployment (#155).

### `vercel-deployment-streak`

Successful deployments in a row. Verified, in deployments. Events: `vercel.deployment.succeeded` and `vercel.deployment.failed`. Minimum history: none.

Vercel deployments that succeeded since the newest failed one, counted in deployments, not days. Counts deployments to every environment (production and preview) until DevMacro records the environment of each deployment (#155).

### `supabase-signups-7d`

Signups in 7 days. Verified, in signups. Events: `supabase.auth.signup`. Minimum history: 7 days.

New users in the project's Supabase projects in the last 7 days, from Supabase's auth logs, one per signup.

### `supabase-signups-30d`

Signups in 30 days. Verified, in signups. Events: `supabase.auth.signup`. Minimum history: 30 days.

New users in the project's Supabase projects in the last 30 days, from Supabase's auth logs, one per signup.

### `resend-emails-month`

Emails this month. Verified, in emails. Snapshots: `resend.emails.monthly.used`. Minimum history: none.

Emails counted against the Resend monthly quota in the current quota month, as Resend reports it (sent and received), added up across the project's Resend teams.

### `resend-quota-percent-month`

Resend monthly quota used. Verified, in percent. Snapshots: `resend.emails.monthly.used` over `resend.emails.monthly.limit`. Minimum history: none.

Emails counted against the Resend monthly quota divided by the monthly quota, in the current quota month, rounded down to a whole percent. Teams with no quota limit are left out.

### `github-actions-minutes-month`

GitHub Actions minutes this month. Verified, in minutes. Snapshots: `github.usage.actions.minutes`. Minimum history: none.

GitHub Actions minutes used this billing month, as GitHub's billing usage report states them. Only accounts on GitHub's enhanced billing platform report it.

### `stripe-customers-30d`

New customers in 30 days. Verified, in customers. Events: `stripe.customer.created`. Minimum history: 30 days.

Customers created on the project's Stripe accounts in the last 30 days, as a count. Never an amount.

### `stripe-payments-30d`

Successful payments in 30 days. Verified, in payments. Events: `stripe.charge.succeeded`. Minimum history: 30 days.

Payments that succeeded on the project's Stripe accounts in the last 30 days, as a count. Never an amount.

## Adding a metric

1. Add the id to the enum in a new migration: `alter type public.public_metric_id add value '<id>';`, then regenerate the database types.
2. Add its definition in `definitions.ts`; the type checker refuses an enum value without one.
3. Add its section here with the same formula; `definitions.test.ts` fails until the page and the code agree.
4. Add its expected value to `simulated-data.test.ts` and boundary cases to `engine.test.ts`.

A metric must read a quantity or an event its provider already stores. A metric about money is never added.
