# Hosted instance runbook

Steps only Eddie performs on the hosted DevMacro instance. This folder stays in the repository and is never published at `/docs` (`src/lib/docs.ts` skips `docs/internal/`). The deployment itself is described for any operator in [Deploy to Vercel and Supabase](../operations/deploy.md); this page adds who does what on the hosted instance.

Agents prepare configuration and preview deployments. They never trigger or promote a production deployment.

## Promote production (Eddie)

1. Merge to `main` after CI passes and the preview has been checked. Vercel builds a production deployment.
2. Before the deployment receives traffic, apply any new migrations ([Deploy, step 2](../operations/deploy.md#2-apply-the-migrations-forward-only)).
3. Promote or confirm the production deployment in Vercel.
4. Run the checks in [Deploy, verify the production deployment](../operations/deploy.md#8-verify-the-production-deployment).

## Hosted OAuth apps

The hosted instance has one registration per app ([OAuth apps](../operations/oauth-apps.md)), owned by the DevMacro account or organization, with callbacks on the production origin. Eddie registers each one and enters its secrets in Vercel. Hosted users connect through these apps and never create their own.

## What stays Eddie's

- Creating the Vercel project, the production (and staging) Supabase projects, and the SMTP sender.
- Registering the sign-in OAuth app and one app per provider ([OAuth apps](../operations/oauth-apps.md)), and entering their secrets.
- Generating and storing the production secrets.
- Running migrations against production, registering the cron job, and inviting testers.
- Promoting production deployments. Agents never trigger or promote one.
- Migrating and rotating the JWT signing keys of the production (and staging) Supabase projects ([JWT signing keys](../operations/deploy.md#jwt-signing-keys)).
- Turning on GitHub secret scanning and push protection for the repository. In **Settings, Code security** (called **Advanced Security** in newer GitHub layouts), enable **Secret scanning** and **Push protection**. For a private repository this needs GitHub Secret Protection, a paid part of GitHub Advanced Security; both are free once the repository is public. Until they are on, the gitleaks scan in CI is the only automated secret check, and it only runs after a push. Confirm with `gh api repos/eddiejaoude/DevMacro --jq '.security_and_analysis'`: `secret_scanning` and `secret_scanning_push_protection` must both show `"status": "enabled"`.
