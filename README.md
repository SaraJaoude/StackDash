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
- Playwright for end-to-end tests

Supabase (database and auth) and Resend (email) are planned and not wired in yet.

## Run it locally

Requires Node.js 20.9 or later and npm.

```bash
git clone git@github.com:eddiejaoude/DevMacro.git
cd DevMacro
npm ci
cp .env.example .env.local   # every variable is optional for local development
npm run dev
```

Open <http://localhost:3000>.

## Checks

```bash
npm run typecheck   # generate route types, then tsc
npm run lint        # eslint, zero warnings allowed
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

| Variable               | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | Public origin used for absolute URLs in page metadata. Optional.     |

## Project layout

```text
src/app/                 routes, root layout, global styles, icon
src/components/          shared UI (nav, footer, section shell, cards, icons)
src/components/sections/ landing page sections
src/lib/site.ts          site-wide constants and navigation links
e2e/                     Playwright specs
```
