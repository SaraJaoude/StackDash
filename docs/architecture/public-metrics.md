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
| Estimated | Calculated by DevMacro | Every surface, labeled Estimated |
| Self-reported | Typed by a person on the public metrics page | The project page only, labeled Self-reported. Never on a badge, a card that claims Verified, or a leaderboard |

Every metric in the first set below is Verified.

### When there is no number

A metric that cannot be computed honestly says why instead of showing a number:

| Reason | Shown as | When |
|---|---|---|
| `not_connected` | Not connected | The project has no included account of the metric's provider, or every connection behind those accounts is disconnected. A disconnected connection keeps its stored rows, but they stop feeding public numbers the moment it is disconnected |
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

| Event type | Title | Body |
|---|---|---|
| `devmacro.metric_published` | Published GitHub stars | Project Acme web. Rounded down to 100, current. |
| `devmacro.metric_published` (self-reported) | Published Downloads this month (self-reported) | Project Acme web. 4,200 downloads. |
| `devmacro.metric_unpublished` | Unpublished GitHub stars | None |
| `devmacro.metrics_unpublished_all` | Unpublished everything | 2 metrics are no longer public. |

"Unpublish everything" revokes every live publication of every project in the workspace in one action, after a confirmation that says how many values it covers and that it reaches every project, not only the one on screen. Deleting an account removes every publication its user made, and deleting a workspace or a project removes theirs. The schema, row level security, and functions are in [Database schema](schema.md#public-metrics-148).

## Reading published values

### Public route

`GET /api/public/projects/<project id>/metrics` returns a project's live publications as JSON, for anyone. A project that does not exist and one with nothing published both answer `404`, so the route never reveals which projects exist. Responses are cached for 60 seconds (`Cache-Control: public, max-age=60, s-maxage=60`), so an unpublished value stops showing within a minute.

The route is same-origin only: it sends no `Access-Control-Allow-Origin`, so a script on another site cannot `fetch` it in a browser. Badges and cards are rendered by DevMacro's own server, and anyone can still read the JSON from a server or with curl. `formulaUrl` is an absolute URL on this DevMacro (from `NEXT_PUBLIC_SITE_URL`, else the request's origin), so a reader off-site can follow it.

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
      "formulaUrl": "https://devmacro.example.com/docs/architecture/public-metrics#github-stars",
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

Server code that shows published values (badges and cards #149, project pages #150, the leaderboard) reads them through `src/lib/public-metrics/published.ts` and never queries `published_metrics` itself:

| Function | Returns |
|---|---|
| `loadPublishedProjectMetrics(projectId, now)` | Every live publication of the project, engine metrics in definition order then self-reported values, or `null` when nothing is published |
| `loadPublishedMetric(projectId, metricId, now)` | One published engine metric, or `null`. It takes a `PublicMetricId`, so a self-reported value can never become a badge |
| `loadPublishedProjectHistory(published)` | The daily history of each published engine metric in what `loadPublishedProjectMetrics` returned, over 90 days ending at the publication's own `asOf` and rounded the same way, plus the milestones those publications reveal. It takes that result, not a project id, so it can only describe what is published |

The first two read live rows through `public_published_metrics()` with the service role and compute each value at its own delay. A leaderboard keeps only `provenance === "verified"` values that are not `simulated`. `src/lib/public-metrics/definitions.ts` holds the definitions (`PUBLIC_METRICS`, `publicMetricDefinition`, `formulaPath`), `engine.ts` computes from any `PublicMetricStore`, and `display.ts` formats values and summaries without touching data. `definitions.ts` and `display.ts` import no adapter, data access, or Node module, so client components can use them; `display.test.ts` walks their imports and fails if one creeps in.

Private surfaces compute values that need not be published. The yearly card (#151) calls `computePublicMetrics(store, requests)` in `engine.ts` with `createSupabaseMetricStore(db, workspaceId, projectId)` and passes `from` on each request, for example 1 January, to count from there instead of the metric's own 7 or 30 days: "stars gained" and "deployments" then cover the year so far, and "Not enough history yet" means the data does not reach back to `from`. Only change and count metrics take `from`; a current total, a percent, or a streak refuses it, and `from` must be before `asOf`. Publications always use the metric's own window.

History points are the engine's own values at each moment, computed by `computeMetricHistories` in `history.ts` with the same formulas as the current value. To avoid reading the database once per day and metric, it computes against `preloadHistoryStore`, a read-through cache that loads the window's snapshots (one read per metric key) and events (up to five pages of 1,000, newest first) once, answers every query it fully covers from memory, and passes anything older to the real store. A read that comes back full may be cut short, so its oldest day is treated as not loaded. Every answer is therefore the real store's answer.

## Project pages

Issue #150. An owner or admin can turn on one public page per project, at `/@<workspace slug>/<page slug>`, on the project's public metrics page. Nothing is public by default. The schema and functions are in [Database schema](schema.md#project-pages-150).

The page shows only what this engine publishes for the project:

| Section | What it shows |
|---|---|
| Published metrics | Every live publication, with its provenance (Verified, Estimated, or Self-reported), when it was last synced or the moment a delayed value describes, a link to its formula, and Simulated when the provider simulator made it up |
| Connected providers | An icon, named for screen readers, for each provider behind a published value that is still connected. Never an account name |
| History | The last 30 and 90 days of each published engine metric, each day's value published with the same rounding and delay as today's. Each chart's accessible name summarizes it, and its values open as a table. Self-reported values have no history |
| Milestones | "First deployment recorded", "First signup recorded", "First customer recorded", and "First successful payment recorded", from the oldest stored event, while a metric counting those events is published exactly (a rounded publication can show 0 while events exist, so it reveals no first-event milestone) and no later than that publication's `asOf`; and "Reached 100 GitHub stars" (also 1,000, 10,000, 100,000) when the published GitHub stars history crosses it, only for thresholds its rounding can show |

Choosing metrics, rounding to 10, 100, or 1,000, and showing values 7 days late are the publication options above; the page follows them. The page settings are the address, whether search engines may index it, and turning it on or off. Each change writes a DevMacro event to the timeline:

| Event type | Title | Body |
|---|---|---|
| `devmacro.project_page_enabled` | Turned on the public project page | Project Acme web. Address /@k3j4h5g6f7/acme-web. Search engines are asked not to index it. |
| `devmacro.project_page_updated` | Updated the public project page | Project Acme web. Address /@k3j4h5g6f7/acme-web. Search engines may index it. |
| `devmacro.project_page_disabled` | Turned off the public project page | Project Acme web. The page is no longer public. |

An address answers only while its page is on and the project has at least one live publication, so "Unpublish everything" takes every page offline too. An unknown address, a page that is off, and a page with nothing published answer the same 404. The page renders per request and is not cached (the enforced nonce policy needs per request HTML, #125), so turning a page off answers 404 from the next request. A page asks search engines not to index it unless its owner allows indexing; `/sitemap.xml` lists the pages that are public and indexable, at most 1,000, and is read per request too. When `NEXT_PUBLIC_SITE_URL` is set, the page names its canonical address and uses the card of its first published engine metric (`/card/<project id>/<metric id>.png`, #149) as its preview image.

`src/proxy.ts` rewrites `/@<workspace slug>/<page slug>` to the page route at `/p/<workspace slug>/<page slug>`, because a route folder starting with `@` is a parallel route slot, and answers every other path under `/@` or `/p` with the global 404, so a page has exactly one address.

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
