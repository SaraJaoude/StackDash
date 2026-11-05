import { config } from "zod";

// Runs in the browser before the app hydrates. App routes enforce a CSP without 'unsafe-eval'
// (src/proxy.ts), and Zod probes for eval with `new Function("")` the first time it parses an
// object, which the browser reports as a violation on every page load even though Zod catches the
// error and falls back. `jitless` skips the probe and the eval-compiled parsers (#125).
config({ jitless: true });
