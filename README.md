# StackDash placeholder

The coming soon page for [stackda.sh](https://stackda.sh): the landing page hero with its animated
product preview, the StackDash logo, a note that StackDash will be open source, and a signup form
for the launch list.

This branch has its own history and is never merged to `main`. The product itself lives on `main`.
Tracked in issue #438.

## Run it

```bash
npm install
npm run dev
```

`npm run build && npm start` serves the production build. The page is fully static.

## Launch list

The signup form saves each address as a Resend contact in one segment (issue #440). Set these in
the Vercel project, never in the repository:

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | A **Full access** key from the StackDash Resend team. A sending-only key cannot create contacts. |
| `RESEND_SEGMENT_ID` | The ID of the launch list segment (Audience, Segments, then Copy ID). |

Without them the form shows an error with a reference, and the server log says which is missing.
Add a Vercel Firewall rate limit rule for `POST /` so a bot cannot flood the list.
