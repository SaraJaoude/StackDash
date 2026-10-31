# DevMacro

The big picture of your developer stack.

DevMacro is an open-source dashboard for the usage, spending, quotas, and activity of the developer
services you build on: see what you have spent, how much allowance is left, and when it resets, and
get alerted before a limit or budget becomes a problem.

**Status:** early development. This repository currently contains the landing page only. The
dashboard, integrations, and self-hosting setup come next.

## Stack

- Next.js 16 (App Router, Cache Components) and React 19
- TypeScript (strict)
- Tailwind CSS 4
- Supabase (Postgres and Auth), run locally with the Supabase CLI
- Vitest for unit tests, Playwright for end-to-end tests

Resend (email) is planned and not wired in yet.

## Run it locally

Requires Node.js 20.9 or later and npm.

```bash
git clone git@github.com:eddiejaoude/DevMacro.git
cd DevMacro
npm ci
cp .env.example .env.local   # fill in the Supabase values, see "Local database" below
npm run dev
```

Open <http://localhost:3000>. The landing page runs without Supabase; anything that signs in or
reads data needs the local database below.

## Local database

DevMacro uses the Supabase CLI to run Postgres, Auth, and the API locally in Docker. Its ports sit
in the 554xx range (API on 55421, database on 55422, Studio on <http://localhost:55423>, email
inbox on <http://localhost:55424>), so it runs beside other local Supabase projects.

1. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
   (version 2.120 or later), for example `brew install supabase/tap/supabase`.
2. Start Docker (Docker Desktop, OrbStack, or another Docker-compatible runtime).
3. Start the stack. The first run downloads the images and applies every migration in
   `supabase/migrations/`.

   ```bash
   supabase start
   ```

4. Copy the keys into `.env.local`. `supabase status` prints them; this command prints them with
   the names the app expects, ready to paste:

   ```bash
   supabase status -o env \
     --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
     --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
     --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY
   ```

5. Apply migrations you have not run yet, for example after pulling new commits:

   ```bash
   supabase migration up
   ```

   Migrations are forward only. Add a new migration with `supabase migration new <name>` and
   never edit one that has been merged. Do not use `supabase db reset` as part of the normal
   workflow: it deletes all local data, and self-hosted installs upgrade with the same forward
   only migrations.

6. Regenerate the database types after any schema change and commit the result:

   ```bash
   npm run db:types         # writes src/lib/supabase/database.types.ts
   npm run db:types:check   # fails if the committed types are stale
   ```

7. Run the unit tests:

   ```bash
   npm test
   ```

Stop the stack with `supabase stop`; your data is kept for the next `supabase start`.

Sign-up is invite only, so the local Auth server has public sign-up turned off.

## Checks

```bash
npm run typecheck   # generate route types, then tsc (includes the generated database types)
npm run lint        # eslint, zero warnings allowed
npm test            # unit tests (Vitest)
npm run build       # production build
```

### End-to-end tests

Install the browser once, then run the suite. Playwright starts its own dev server on port 3100
(override with `E2E_PORT`).

```bash
npx playwright install chromium
npm run test:e2e
```

## Environment variables

See [`.env.example`](.env.example). Values are never committed.

| Variable                               | Purpose                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                 | Public origin used for absolute URLs in page metadata. Optional.                              |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase API URL. Public.                                                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key. Public; row level security limits what it can read.                 |
| `SUPABASE_SERVICE_ROLE_KEY`            | Supabase service role key. Secret, server only, bypasses row level security. Never public.    |

## Project layout

```text
src/app/                 routes, root layout, global styles, icon
src/components/          shared UI (nav, footer, section shell, cards, icons)
src/components/sections/ landing page sections
src/lib/site.ts          site-wide constants and navigation links
src/lib/env.ts           validated access to environment variables
src/lib/supabase/        Supabase clients (server, browser, service role) and generated types
supabase/config.toml     local Supabase stack configuration
supabase/migrations/     forward-only SQL migrations
e2e/                     Playwright specs
```

## Third-party marks

The platform logos on the landing page use path data from [Simple Icons](https://simpleicons.org)
(CC0-1.0). The logos remain trademarks of their owners and identify the integrations DevMacro
connects to. Their use implies no endorsement.
