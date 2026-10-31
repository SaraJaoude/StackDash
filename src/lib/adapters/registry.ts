import "server-only";

import { log } from "@/lib/log/logger";

import { fakeAdapter, FAKE_PROVIDER_ENABLE_ENV } from "./fake";
import { githubAdapter } from "./github";
import { resendAdapter } from "./resend";
import { stripeAdapter } from "./stripe";
import { supabaseAdapter } from "./supabase";
import {
  liveProviderIds,
  Secret,
  type AdapterContext,
  type LiveProviderId,
  type OAuthClient,
  type OAuthContext,
  type ProviderAdapter,
  type ProviderId,
} from "./types";
import { vercelAdapter } from "./vercel";

/**
 * The one place that maps a provider id to its adapter. Everything else (routes, pages, the sync
 * runner) asks the registry, so adding a provider is one entry here plus its adapter.
 */

const ADAPTER_TIMEOUT_MS = 15_000;

const liveAdapters: Readonly<Record<LiveProviderId, ProviderAdapter>> = {
  vercel: vercelAdapter,
  github: githubAdapter,
  resend: resendAdapter,
  stripe: stripeAdapter,
  supabase: supabaseAdapter,
};

/** Read on every call, not at module load, so the flag can never be baked into a build. */
export function isFakeProviderEnabled(): boolean {
  return process.env[FAKE_PROVIDER_ENABLE_ENV] === "1";
}

/** The adapter for `id`. The fake provider exists only when DEVMACRO_ENABLE_FAKE_PROVIDER is "1". */
export function getAdapter(id: ProviderId): ProviderAdapter {
  if (id === "fake") {
    if (!isFakeProviderEnabled()) {
      throw new Error(`The fake provider is disabled; set ${FAKE_PROVIDER_ENABLE_ENV}=1 to use it.`);
    }
    return fakeAdapter;
  }
  return liveAdapters[id];
}

/** Every provider a person can pick on this instance, in catalog order; the fake one last. */
export function availableProviders(): ProviderAdapter[] {
  const adapters = liveProviderIds.map((id) => liveAdapters[id]);
  return isFakeProviderEnabled() ? [...adapters, fakeAdapter] : adapters;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * The OAuth app settings this instance registered for `adapter`, or null when any required
 * variable is empty: the catalog then says the provider is not set up here. Extra keys listed in
 * `optionalExtraKeys` are passed through only when set and never make the provider unavailable.
 */
export function loadOAuthClient(adapter: ProviderAdapter): OAuthClient | null {
  const { clientIdEnv, clientSecretEnv, extraEnv, optionalExtraKeys } = adapter.oauth;
  const clientId = readEnv(clientIdEnv);
  const clientSecret = readEnv(clientSecretEnv);
  if (clientId === undefined || clientSecret === undefined) return null;

  const optional = new Set(optionalExtraKeys ?? []);
  const extra: Record<string, Secret> = {};
  for (const [key, envName] of Object.entries(extraEnv ?? {})) {
    const value = readEnv(envName);
    if (value === undefined) {
      if (optional.has(key)) continue;
      return null;
    }
    extra[key] = new Secret(value);
  }
  return { clientId, clientSecret: new Secret(clientSecret), extra };
}

/** True when this instance has registered the provider's OAuth app. Never exposes the values. */
export function isProviderConfigured(adapter: ProviderAdapter): boolean {
  return loadOAuthClient(adapter) !== null;
}

export function createAdapterContext(): AdapterContext {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    timeoutMs: ADAPTER_TIMEOUT_MS,
    logger: {
      info: (event, fields) => log.info(event, fields),
      warn: (event, fields) => log.warn(event, fields),
      error: (event, fields) => log.error(event, fields),
    },
  };
}

export function createOAuthContext(client: OAuthClient): OAuthContext {
  return { ...createAdapterContext(), client };
}
