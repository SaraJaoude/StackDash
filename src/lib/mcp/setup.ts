/*
 * How to connect each MCP client to this instance (#163), for the settings page. docs/mcp.md walks
 * through the same steps with the URL as $DEVMACRO_URL. The key is never written into a snippet:
 * each one reads it from DEVMACRO_API_KEY, or says where to paste it.
 *
 * Sources, checked 2026-11-05:
 * - Claude Code: https://code.claude.com/docs/en/mcp, "Option 1: Add a remote HTTP server".
 * - Claude Desktop: Settings, Developer, Edit Config, then a restart, per
 *   https://modelcontextprotocol.io/docs/develop/connect-local-servers. The remote server is reached
 *   through mcp-remote (README, "Custom Headers", https://www.npmjs.com/package/mcp-remote), with
 *   the header in an env variable because Claude Desktop on Windows does not escape spaces in args.
 *   Custom connectors with request headers are the alternative for an instance on the public
 *   internet (https://claude.com/docs/connectors/custom/add-unlisted); docs/mcp.md covers them.
 * - Cursor: https://cursor.com/docs/mcp, "Config interpolation".
 */

/** The MCP endpoint's path on every DevMacro instance. */
export const MCP_ENDPOINT_PATH = "/api/mcp";

export type McpClientSetup = Readonly<{
  id: "claude-code" | "claude-desktop" | "cursor" | "other";
  name: string;
  /** What to do with the snippet, in one or two sentences. */
  instructions: string;
  snippet: string;
}>;

const KEY_VARIABLE = "DEVMACRO_API_KEY";

export function mcpEndpointUrl(origin: string): string {
  return new URL(MCP_ENDPOINT_PATH, origin).href;
}

export function mcpClientSetups(endpointUrl: string): readonly McpClientSetup[] {
  const claudeDesktop = {
    mcpServers: {
      devmacro: {
        command: "npx",
        args: ["-y", "mcp-remote", endpointUrl, "--header", "Authorization:${AUTH_HEADER}"],
        env: { AUTH_HEADER: "Bearer paste-your-key-here" },
      },
    },
  };
  const cursor = {
    mcpServers: {
      devmacro: { url: endpointUrl, headers: { Authorization: `Bearer \${env:${KEY_VARIABLE}}` } },
    },
  };
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      instructions: `Put the key in ${KEY_VARIABLE} in your shell, then run this once. Check it with claude mcp list.`,
      snippet: `claude mcp add --transport http devmacro ${endpointUrl} \\\n  --header "Authorization: Bearer $${KEY_VARIABLE}"`,
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      instructions:
        "Open Settings, then Developer, then Edit Config, and add this to claude_desktop_config.json with your key after Bearer. Restart Claude Desktop. It needs Node.js for npx.",
      snippet: JSON.stringify(claudeDesktop, null, 2),
    },
    {
      id: "cursor",
      name: "Cursor",
      instructions: `Add this to ~/.cursor/mcp.json, or .cursor/mcp.json in a project. Cursor reads the key from ${KEY_VARIABLE} in the environment it starts from.`,
      snippet: JSON.stringify(cursor, null, 2),
    },
    {
      id: "other",
      name: "Other clients",
      instructions:
        "Any client that speaks the Streamable HTTP transport works. Give it the URL and send the key as a bearer token on every request.",
      snippet: [`URL:        ${endpointUrl}`, "Transport:  Streamable HTTP", "Header:     Authorization: Bearer <your key>"].join("\n"),
    },
  ];
}
