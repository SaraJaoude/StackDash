import { config } from "zod";

// App routes enforce a CSP without 'unsafe-eval' (src/proxy.ts). Zod probes for eval with
// `new Function("")` while it constructs an object schema, so the first `z.object(...)` a client
// module evaluates triggers the probe before anything is parsed. The browser reports the blocked
// probe as a violation on every page load, even though Zod catches the error and falls back.
// `jitless` (stored on `globalThis.__zod_globalConfig`) skips the probe and the eval-compiled
// parsers. It has to be set by synchronous top-level code here: Next.js runs only that before
// hydration evaluates the app's client modules (instrumentation-client.md, "Execution timing").
// Issue #125.
config({ jitless: true });
