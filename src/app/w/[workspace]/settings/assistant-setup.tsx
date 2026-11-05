import Link from "next/link";

import { mcpClientSetups } from "@/lib/mcp/setup";

/**
 * The AI assistants section of settings (#163): this instance's MCP server URL and the snippet
 * that connects each client. A server component; the snippets are text to select and copy.
 */
export function AssistantSetup({ endpointUrl, canManageKeys }: { endpointUrl: string; canManageKeys: boolean }) {
  return (
    <section aria-labelledby="assistants-title" className="mt-6 rounded-xl border border-line bg-panel">
      <div className="border-b border-line px-6 py-4">
        <h2 id="assistants-title" className="text-sm font-semibold">
          AI assistants
        </h2>
        <p className="mt-1 text-sm text-muted">
          Let Claude, Cursor, or another assistant answer questions about this workspace through its MCP server. The
          server only reads, and it uses an API key, so the assistant sees only what the key may read.{" "}
          <Link href="/docs/mcp" className="text-foreground underline underline-offset-2">
            Read the MCP guide
          </Link>
        </p>
      </div>
      <div className="px-6 py-5 text-sm">
        <dl className="grid gap-1 sm:grid-cols-3 sm:gap-4">
          <dt className="text-muted">Server URL</dt>
          <dd className="break-all font-mono sm:col-span-2">{endpointUrl}</dd>
        </dl>
        <ol className="mt-5 list-decimal space-y-2 pl-5">
          <li>
            {canManageKeys
              ? "Create an API key above for the assistant."
              : "Ask an owner or admin of this workspace for an API key for the assistant."}{" "}
            Give it every scope so the assistant can answer any question. Without usage and spend, it sees no amounts
            anywhere, including in events and alerts.
          </li>
          <li>Add the server to your assistant with one of the snippets below.</li>
        </ol>
        {mcpClientSetups(endpointUrl).map((setup) => (
          <div key={setup.id} className="mt-6">
            <h3 className="font-semibold">{setup.name}</h3>
            <p className="mt-1 text-muted">{setup.instructions}</p>
            {/* Scrollable blocks take focus so keyboard users can scroll them, as on the docs pages. */}
            <pre
              tabIndex={0}
              className="mt-2 overflow-x-auto rounded-lg border border-line bg-panel-raised p-4 font-mono text-[13px] leading-6 text-foreground/90"
            >
              <code>{setup.snippet}</code>
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}
