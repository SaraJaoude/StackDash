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

`GET /api/public/projects/<project id>/metrics` returns a project's live publications as JSON, for anyone. A project that does not exist and one with nothing published both answer `404`, so the route never reveals which projects exist. Responses are cached for 60 seconds (`Cache-Control: public, max-age=60, s-maxage=60`), so an unpublished value stops showing within a minute. It shares the per IP [rate limit](#rate-limit) with badges and cards.

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
| `loadPublishedMetricCard(projectId, metricId, now, trendDays)` | The same, with its trend: the published value at the same time of day on each of the last `trendDays` days, rounded as the publication is, so a rounded metric's trend never reveals exact numbers |

All of them read live rows through `public_published_metrics()` with the service role and compute each value at its own delay. A leaderboard keeps only `provenance === "verified"` values that are not `simulated`. `src/lib/public-metrics/definitions.ts` holds the definitions (`PUBLIC_METRICS`, `publicMetricDefinition`, `formulaPath`), `engine.ts` computes from any `PublicMetricStore`, and `display.ts` formats values and summaries without touching data. `share.ts` builds badge and card URLs (`badgePath`, `cardPath`), alt text, and share text, and `badge.ts` renders the SVG. `definitions.ts`, `display.ts`, `share.ts`, and `badge.ts` import no adapter, data access, or Node module, so client components can use them; `display.test.ts` walks their imports and fails if one creeps in.

Private surfaces compute values that need not be published. The [yearly card](#yearly-card) (#151) calls `computePublicMetrics(store, requests)` in `engine.ts` with `createSupabaseMetricStore(db, workspaceId, null)` (every included account of the workspace) and passes `from` on each request to count from there instead of the metric's own 7 or 30 days. Only change and count metrics take `from`; a current total, a percent, or a streak refuses it, and `from` must be before `asOf`. `historyStart(store, metricId)` says where a change or count metric's stored history starts, so a caller can start its window there instead of reporting "Not enough history yet". Publications always use the metric's own window.

## Badges and cards

Issue #149. Every published engine metric has a live badge and a card, keyed by project id like the public route (decision on issue #149):

| Route | What it serves |
|---|---|
| `GET /badge/<project id>/<metric id>.svg` | A two part SVG badge: the metric's label, then its value and provenance ("1,200+ verified", "1,204 simulated"). Its `<title>` says it all in words, with the last sync time. A value with no number says why ("Not enough history yet") |
| `GET /card/<project id>/<metric id>.png` | A 1200 by 630 PNG for posts and link previews: label, value, provenance, the trend over the last 30 days, and the last sync time. Rendered by Next.js `ImageResponse`, no external image service |

Both follow the same rules:

- Values come from the engine through `loadPublishedMetric` and `loadPublishedMetricCard`, so a badge shows exactly what the public route shows. A self-reported value has no badge or card. No spend, budget, alert, account, or repository data can appear, because the engine has no metric for them.
- A project that does not exist, a metric that is not published or was unpublished, a malformed id, and a wrong extension all get the same neutral "Unpublished" badge or "Not published" card with a `200`, so an embed never shows a broken image and never tells which projects exist.
- Cached for 60 seconds like the public route, so a newly published value shows and an unpublished one disappears within a minute. Errors are `503` and rate limited requests `429`, both `no-store`.
- Safe to embed anywhere: no session is read and no cookie is set, `Cross-Origin-Resource-Policy: cross-origin` lets other sites load them as images, and the SVG is text only, every string escaped. Opened directly, a badge can load and run nothing: `next.config.ts` sends `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox` for `/badge/*` in place of the static policy. It has to be set there, because Next applies the config's headers before a route handler runs and drops a handler header of the same name.

The public metrics page (Projects, then Public metrics) has a Share button beside each published metric. Its dialog shows the badge and card, the badge Markdown for a README (linking to the metric's formula), the card URL, the card's alt text, and "Share to X", which opens X's prefilled post for the person to edit and send. Nothing is posted automatically.

### Rate limit

The badge, card, and JSON routes allow 120 requests per client IP per minute between them (`PUBLIC_REQUESTS_PER_MINUTE` in `src/lib/public-metrics/requests.ts`), then answer `429` with `Retry-After` until the next minute. The count lives in Postgres (`public_rate_limit_counters`), so every server instance shares it. The IP comes from `x-real-ip`, else the first `x-forwarded-for` entry (Vercel sets both and does not forward a client's own); it is hashed with HMAC-SHA-256 under a key derived from `DEVMACRO_ENCRYPTION_KEY` before it is stored, and the table accepts nothing but such a hash. Requests a cache answers never reach DevMacro and are not counted. Counters are deleted after a day.

### View counts

Each time DevMacro serves a published metric's badge or card it counts one view for that project, metric, surface, and UTC day (`published_metric_views`), after the response has gone. The share dialog shows the last 7 days: "DevMacro served the badge 12 times and the card 3 times, including previews here." It counts what DevMacro served, not every reader: a cache in between (a CDN, GitHub's image proxy) serves copies for up to a minute that are not counted. Unpublishing stops the count. Counts are kept 13 months.

## Yearly card

Issue #151. `/w/<workspace>/year/<year>` shows a workspace's year as a card: deployments shipped, stars gained, signups, and providers connected, counted by the engine from stored data across every included account of the workspace. Dashboard, then "Your 2026 so far", opens the current year's card.

- The current year's card is there at any time as the year to date: titled "Your stack in 2026 so far", tagged "Year to date", and counted up to now. Once the year ends (1 January, UTC), the same page shows the whole year, tagged "2026 in review" (decision on issue #151). Past years link from the page; a year that has not started is a `404`.
- Each figure counts from 1 January, or from where its stored history starts when that is later (`historyStart`), and then says "since" that day. A figure whose provider was connected only after the year reads "No data in 2025".
- Emails and GitHub Actions minutes are monthly totals in the engine, with no yearly formula, so they are not on the card (decision on issue #151). No money appears.
- Private: the page and its image, `/w/<workspace>/year/<year>/card.png`, answer only members (`Cache-Control: private, no-store`, the same `404` for anyone else). Share opens the same dialog as milestone cards, with Download card in place of a public URL, the alt text, and "Share to X" with prefilled text. The card is public only once a member posts it.
- A card that rests on simulated data says "Simulated data, not verified".

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
