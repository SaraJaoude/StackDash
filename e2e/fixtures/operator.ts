/*
 * The operator the e2e app names on /privacy and /terms (#339). playwright.config.ts gives the app
 * these synthetic values, which take precedence over .env.local, so the run never depends on, or
 * shows, the hosted instance's operator.
 */
export const E2E_OPERATOR = {
  DEVMACRO_OPERATOR_NAME: "Example Operator Ltd",
  DEVMACRO_OPERATOR_EMAIL: "privacy@example.com",
  DEVMACRO_GOVERNING_LAW: "England and Wales",
} as const;
