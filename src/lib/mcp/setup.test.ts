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

  it("gives Claude Desktop and Cursor configuration files that parse and name the endpoint", () => {
    expect(JSON.parse(byId["claude-desktop"]?.snippet ?? "")).toEqual({
      mcpServers: {
        devmacro: {
          command: "npx",
          args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${AUTH_HEADER}"],
          env: { AUTH_HEADER: "Bearer paste-your-key-here" },
        },
      },
    });
    expect(JSON.parse(byId.cursor?.snippet ?? "")).toEqual({
      mcpServers: { devmacro: { url: endpoint, headers: { Authorization: "Bearer ${env:DEVMACRO_API_KEY}" } } },
    });
  });

  it("reads the key from the environment in the Claude Code command rather than embedding one", () => {
    expect(byId["claude-code"]?.snippet).toBe(
      `claude mcp add --transport http devmacro ${endpoint} \\\n  --header 'Authorization: Bearer \${DEVMACRO_API_KEY}'`,
    );
  });

  it("never contains a key or a dash in the words people read", () => {
    for (const setup of setups) {
      expect(setup.snippet).not.toMatch(/dmk_/);
      expect(`${setup.name} ${setup.instructions}`).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
