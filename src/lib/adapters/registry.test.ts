import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_AUTHORIZE_ORIGINS } from "@/lib/providers";

import { fakeAdapter } from "./fake";
import {
  availableProviders,
  createAdapterContext,
  createOAuthContext,
  getAdapter,
  isProviderConfigured,
  loadOAuthClient,
} from "./registry";
import { liveProviderIds, Secret, type ProviderAdapter } from "./types";

function withOAuth(oauth: Partial<ProviderAdapter["oauth"]>): ProviderAdapter {
  return { ...fakeAdapter, oauth: { ...fakeAdapter.oauth, ...oauth } };
}

const TEST_ADAPTER = withOAuth({
  clientIdEnv: "TEST_REGISTRY_CLIENT_ID",
  clientSecretEnv: "TEST_REGISTRY_CLIENT_SECRET",
  extraEnv: { slug: "TEST_REGISTRY_SLUG", testKey: "TEST_REGISTRY_TEST_KEY" },
  optionalExtraKeys: ["testKey"],
});

function setRequired(): void {
  vi.stubEnv("TEST_REGISTRY_CLIENT_ID", "client-id");
  vi.stubEnv("TEST_REGISTRY_CLIENT_SECRET", "client-secret");
  vi.stubEnv("TEST_REGISTRY_SLUG", "devmacro");
  vi.stubEnv("TEST_REGISTRY_TEST_KEY", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAdapter", () => {
  it("returns the adapter for every live provider id", () => {
    for (const id of liveProviderIds) {
      expect(getAdapter(id).id).toBe(id);
    }
  });

  it("refuses the fake provider when the flag is unset", () => {
    vi.stubEnv("DEVMACRO_ENABLE_FAKE_PROVIDER", "");
    expect(() => getAdapter("fake")).toThrow(/disabled/);
  });

  it("refuses the fake provider when the flag is any value other than 1", () => {
    vi.stubEnv("DEVMACRO_ENABLE_FAKE_PROVIDER", "true");
    expect(() => getAdapter("fake")).toThrow(/disabled/);
  });

  it("returns the fake provider when the flag is exactly 1", () => {
    vi.stubEnv("DEVMACRO_ENABLE_FAKE_PROVIDER", "1");
    expect(getAdapter("fake")).toBe(fakeAdapter);
  });
});

describe("availableProviders", () => {
  it("lists only live providers, in catalog order, when the fake flag is unset", () => {
    vi.stubEnv("DEVMACRO_ENABLE_FAKE_PROVIDER", "");
    expect(availableProviders().map((adapter) => adapter.id)).toEqual([...liveProviderIds]);
  });

  it("adds the fake provider last when the flag is 1", () => {
    vi.stubEnv("DEVMACRO_ENABLE_FAKE_PROVIDER", "1");
    expect(availableProviders().map((adapter) => adapter.id)).toEqual([...liveProviderIds, "fake"]);
  });
});

describe("loadOAuthClient", () => {
  it("returns the client with required extras wrapped in Secret when every variable is set", () => {
    setRequired();
    const client = loadOAuthClient(TEST_ADAPTER);
    expect(client?.clientId).toBe("client-id");
    expect(client?.clientSecret).toBeInstanceOf(Secret);
    expect(client?.clientSecret.reveal()).toBe("client-secret");
    expect(client?.extra.slug?.reveal()).toBe("devmacro");
  });

  it("leaves an unset optional extra out instead of returning null", () => {
    setRequired();
    const client = loadOAuthClient(TEST_ADAPTER);
    expect(client).not.toBeNull();
    expect(client?.extra).not.toHaveProperty("testKey");
  });

  it("includes an optional extra when it is set", () => {
    setRequired();
    vi.stubEnv("TEST_REGISTRY_TEST_KEY", "sk_test_value");
    expect(loadOAuthClient(TEST_ADAPTER)?.extra.testKey?.reveal()).toBe("sk_test_value");
  });

  it("returns null when the client id is empty", () => {
    setRequired();
    vi.stubEnv("TEST_REGISTRY_CLIENT_ID", "");
    expect(loadOAuthClient(TEST_ADAPTER)).toBeNull();
    expect(isProviderConfigured(TEST_ADAPTER)).toBe(false);
  });

  it("returns null when the client secret is only whitespace", () => {
    setRequired();
    vi.stubEnv("TEST_REGISTRY_CLIENT_SECRET", "   ");
    expect(loadOAuthClient(TEST_ADAPTER)).toBeNull();
  });

  it("returns null when a required extra is empty", () => {
    setRequired();
    vi.stubEnv("TEST_REGISTRY_SLUG", "");
    expect(loadOAuthClient(TEST_ADAPTER)).toBeNull();
  });

  it("works for an adapter with no extras", () => {
    vi.stubEnv("FAKE_PROVIDER_CLIENT_ID", "fake-client");
    vi.stubEnv("FAKE_PROVIDER_CLIENT_SECRET", "fake-secret");
    expect(loadOAuthClient(fakeAdapter)?.extra).toEqual({});
  });

  it("never serializes the secret", () => {
    setRequired();
    expect(JSON.stringify(loadOAuthClient(TEST_ADAPTER))).not.toContain("client-secret");
  });
});

describe("createOAuthContext", () => {
  it("carries the client, a 15 second timeout, and a live clock", () => {
    setRequired();
    const client = loadOAuthClient(TEST_ADAPTER);
    if (client === null) throw new Error("expected a client");
    const ctx = createOAuthContext(client);
    expect(ctx.client).toBe(client);
    expect(ctx.timeoutMs).toBe(15_000);
    expect(ctx.now()).toBeInstanceOf(Date);
    expect(createAdapterContext().timeoutMs).toBe(15_000);
  });
});

describe("PROVIDER_AUTHORIZE_ORIGINS", () => {
  it("names the origin of every live adapter's authorize URL, which the proxy's form-action allows", () => {
    for (const id of liveProviderIds) {
      const adapter = getAdapter(id);
      const client = {
        clientId: "client-id",
        clientSecret: new Secret("client-secret"),
        extra: Object.fromEntries(Object.keys(adapter.oauth.extraEnv ?? {}).map((key) => [key, new Secret("devmacro")])),
      };
      const url = adapter.buildAuthorizeUrl({
        client,
        state: "state",
        redirectUri: `https://devmacro.example/api/connections/${id}/callback`,
        codeChallenge: "challenge",
      });
      expect(url.origin, id).toBe(PROVIDER_AUTHORIZE_ORIGINS[id]);
    }
  });
});
