import { describe, expect, it } from "vitest";

import { mcpClientSetups, mcpEndpointUrl } from "./setup";

describe("mcpEndpointUrl", () => {
  it.each([
    ["https://devmacro.example.com", "https://devmacro.example.com/api/mcp"],
    ["https://devmacro.example.com/", "https://devmacro.example.com/api/mcp"],
    ["http://localhost:3000", "http://localhost:3000/api/mcp"],
  ])("puts the endpoint on the origin %s", (origin, expected) => {
    expect(mcpEndpointUrl(origin)).toBe(expected);
  });
});

describe("mcpClientSetups", () => {
  const endpoint = "https://devmacro.example.com/api/mcp";
  const setups = mcpClientSetups(endpoint);
  const byId = Object.fromEntries(setups.map((setup) => [setup.id, setup]));

  it("covers Claude Code, Claude Desktop, Cursor, and other clients, each with this instance's URL", () => {
    expect(setups.map((setup) => setup.id)).toEqual(["claude-code", "claude-desktop", "cursor", "other"]);
    for (const setup of setups) expect(setup.snippet).toContain(endpoint);
  });

  it("gives Claude Desktop a config file that parses, names the endpoint, and sends the key as a bearer header", () => {
    const config = JSON.parse(byId["claude-desktop"]?.snippet ?? "") as {
      mcpServers: { devmacro: { args: string[]; env: Record<string, string> } };
    };
    const { args, env } = config.mcpServers.devmacro;
    expect(args).toContain(endpoint);
    const header = args[args.indexOf("--header") + 1];
    expect(header).toMatch(/^Authorization:\$\{(\w+)\}$/);
    const variable = /\$\{(\w+)\}/.exec(header ?? "")?.[1] ?? "";
    expect(env[variable]).toMatch(/^Bearer /);
  });

  it("gives Cursor a config file that parses, names the endpoint, and reads the key from DEVMACRO_API_KEY", () => {
    const config = JSON.parse(byId.cursor?.snippet ?? "") as {
      mcpServers: { devmacro: { url: string; headers: Record<string, string> } };
    };
    const { url, headers } = config.mcpServers.devmacro;
    expect(url).toBe(endpoint);
    expect(headers.Authorization).toMatch(/^Bearer \$\{env:DEVMACRO_API_KEY\}$/);
  });

  it("passes the Claude Code header in single quotes, so the shell leaves the variable for Claude Code", () => {
    const snippet = byId["claude-code"]?.snippet ?? "";
    expect(snippet).toContain(endpoint);
    expect(/--header '([^']*)'/.exec(snippet)?.[1]).toMatch(/^Authorization: Bearer \$\{DEVMACRO_API_KEY\}$/);
  });

  it("never leaves the key variable inside double quotes, where the shell would expand it", () => {
    expect(byId["claude-code"]?.snippet).not.toMatch(/"[^"]*\$\{?DEVMACRO_API_KEY/);
  });

  it("never contains a key or a dash in the words people read", () => {
    for (const setup of setups) {
      expect(setup.snippet).not.toMatch(/dmk_/);
      expect(`${setup.name} ${setup.instructions}`).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
