# MCP server

The MCP server lets an AI assistant such as Claude Code, Claude Desktop, or Cursor answer questions about one workspace from its own data: what changed in the stack this week, how much of an allowance is left, which alerts fired. It only reads. No tool can change anything in a workspace, and no answer contains a provider credential.

Issues: #163 (this server), #162 (the API keys and scopes it uses).

It speaks the [Model Context Protocol](https://modelcontextprotocol.io/specification/2026-07-28) over the Streamable HTTP transport at `/api/mcp` on your DevMacro site, and serves clients of the 2025 protocol revisions as well as 2026-07-28. Self-hosted installs serve the same endpoint; nothing about it depends on the hosted instance.

## Create a key

The server uses the same API keys as the [REST API](api.md). An owner or admin creates one in the workspace's **Settings**, under **API keys**; see [Create a key](api.md#create-a-key) for the details.

Give a key for an assistant every scope, so it can answer any question about the workspace. A key without `usage:read` never sees an amount: `get_usage` refuses it, and `list_events` and `list_alerts` withhold the text and money that can quote one (see [What a tool returns](#what-a-tool-returns)).

**Settings**, under **AI assistants**, shows this site's server URL and the snippets below with that URL filled in.

## Connect a client

Each example reads the key from the environment rather than writing it into a file you might share. Put it in `DEVMACRO_API_KEY` in your shell profile, and set `DEVMACRO_URL` to your DevMacro site, for example `https://your-devmacro-site.example.com` or `http://localhost:3000` for a local install.

### Claude Code

```bash
claude mcp add --transport http devmacro "$DEVMACRO_URL/api/mcp" \
  --header "Authorization: Bearer $DEVMACRO_API_KEY"
claude mcp list
```

`claude mcp list` shows `devmacro` as connected. Add `--scope project` to share the server through the project's `.mcp.json`; there, write the header as `"Authorization": "Bearer ${DEVMACRO_API_KEY}"` so the key stays in each person's environment ([Claude Code, MCP](https://code.claude.com/docs/en/mcp)).

### Claude Desktop

Open **Settings**, then **Developer**, then **Edit Config**, and add the server to `claude_desktop_config.json`, with your site's URL and your key after `Bearer`:

```json
{
  "mcpServers": {
    "devmacro": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-devmacro-site.example.com/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer paste-your-key-here" }
    }
  }
}
```

Then quit and restart Claude Desktop. [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) connects Claude Desktop's local servers to a remote one and needs Node.js. The header goes through `AUTH_HEADER` because Claude Desktop on Windows does not escape spaces in `args` (mcp-remote README, "Custom Headers"). It accepts `http://localhost` for a local install.

For an instance on the public internet, a custom connector also works where your Claude plan offers request headers (a beta): **Customize**, **Connectors**, **Add custom connector**, the server URL, **No sign-in**, then an `authorization` request header with the value `Bearer` and your key ([Claude, custom connectors](https://claude.com/docs/connectors/custom/add-unlisted)). Claude connects to a custom connector from Anthropic's cloud, so it cannot reach a server on your own computer or private network.

### Cursor

Add the server to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "devmacro": {
      "url": "https://your-devmacro-site.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${env:DEVMACRO_API_KEY}" }
    }
  }
}
```

Cursor reads `DEVMACRO_API_KEY` from the environment it was started from ([Cursor, MCP, config interpolation](https://cursor.com/docs/mcp)).

### Other clients

Any client that speaks Streamable HTTP works: give it the URL `$DEVMACRO_URL/api/mcp` and send `Authorization: Bearer <key>` on every request. The endpoint keeps no sessions, so every message is a POST; `GET` and `DELETE` answer `405`.

## Tools

| Tool | Scope | What it returns | Arguments |
|---|---|---|---|
| `list_projects` | any working key | The key's workspace and its projects, oldest first | `limit`, `cursor` |
| `get_usage` | `usage:read` | Daily usage, spend, allowance, credit balance, and revenue snapshots, newest day first. The latest day of a metric is its current value | `provider`, `project_id`, `from` and `to` (UTC days, inclusive), `metric_key`, `kind`, `limit`, `cursor` |
| `list_events` | `events:read` | The timeline, newest first: deployments, payments, sync failures, alerts, daily summaries | `from` (inclusive) and `to` (exclusive) as RFC 3339 times, `type`, `severity`, `provider`, `limit`, `cursor` |
| `list_alerts` | `alerts:read` | Alerts that fired, newest first, with the severity the alerts page shows | `acknowledged` (`true` or `false`), `limit`, `cursor` |
| `get_connection_status` | `connections:read` | Each connection's status and last sync, oldest first. Never credentials | `limit`, `cursor` |

The arguments are the REST API's query parameters, with the same limits: `limit` is 1 to 100 (default 50), an unknown argument is refused, and `cursor` is the `next_cursor` of the previous page, passed back with the same filters.

## Resources

Each provider page in [`docs/providers/`](providers) is a Markdown resource at `devmacro://docs/providers/<provider>`, for example `devmacro://docs/providers/resend`. An assistant reads them to explain what a metric means, how DevMacro reads it, and whether it is verified or estimated.

## What a tool returns

Every tool answers with JSON, both as `structuredContent` (with an `outputSchema` in the tool list) and as text for clients that read only text:

- `read_at`: when DevMacro read the answer from its database.
- `data` and `next_cursor`: one page of rows, as in the REST API, with the same fields and units. Money is `amount_minor` in the currency's minor unit plus an ISO 4217 `currency`; quantities are `value` plus `unit`; `provenance` is `verified` or `estimated`; `simulated` marks data the provider simulator made up.
- `get_usage` rows keep `retrieved_at`, when DevMacro fetched the number from the provider, and add `display`, the amount or quantity formatted for people (`$12.50`, `1,200 emails`), so an assistant never reads cents as dollars.
- `list_alerts` rows add `display` for the amount a spend alert measured.
- `withheld`: on `list_events` and `list_alerts`, null for a key with `usage:read`. For a key without it, it lists the fields set to null in every row, names `usage:read` as the scope that would return them, and says why. Event titles and bodies are withheld because providers and DevMacro's own daily summaries and spend alerts quote amounts there; an alert's `message`, `threshold_label`, `observed_amount_minor`, `currency`, and `display` because a spend or budget alert quotes money.

## Errors and limits

- A key that is missing or does not work gets HTTP `401` with the REST API's error envelope and a reference id, before any MCP message is read. Past the rate limit it gets `429` with `Retry-After`.
- The rate limit is the REST API's: 120 requests per key per minute. Every MCP message is one request, so the messages a client sends to connect count as well as each tool call.
- A tool the key's scopes do not allow, a malformed argument, or a changed cursor answers with a tool error the assistant can read (`isError: true`), saying what to do next. A failure on the server answers with a generic message and a reference id; the details are in the server log against that id.
- A request from a web page on another site (an `Origin` header that is not this site) gets `403`, as the Streamable HTTP transport requires. A request body over 64 KiB gets `413`; no tool takes anything near that size.

## Try it against the demo data

On a local install with the simulated providers on (`DEVMACRO_SIMULATE_PROVIDERS=1`), `npm run demo:seed -- --member you@example.com` builds a demo workspace with 90 days of history and adds your account as an admin (see the header of `scripts/demo-seed.ts`). Create a key with every scope in that workspace's settings, connect Claude Code as above with `DEVMACRO_URL=http://localhost:3000`, and ask, for example, "Which projects are in my DevMacro workspace, and how much Resend quota is left?"

## Security

- The server reads through the same database functions as the REST API, with the hash of the presented key. The database resolves the workspace from that hash, so a key never reads another workspace, whatever a tool is asked.
- The key itself is never stored, logged, or passed on: the server works with its SHA-256 hash.
- Responses are `Cache-Control: no-store`.
