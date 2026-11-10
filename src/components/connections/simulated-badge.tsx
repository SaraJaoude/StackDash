/**
 * Marks a connection the provider simulator made, and data from it (#131), so made-up data is never
 * mistaken for real data. Words, not color alone. Callers decide on the server: an existing
 * connection from its own marker (`isSimulatedConnection`), the catalog and connect screen from
 * the adapter this instance uses.
 */
export function SimulatedBadge() {
  return (
    <span
      title="Example data made up on this computer, not read from the provider"
      className="inline-flex shrink-0 items-center rounded-full border border-warning/40 px-2 py-0.5 text-xs font-medium text-warning"
    >
      Simulated
    </span>
  );
}

/**
 * Says "Simulated" once for a page whose every connection in view the simulator made (#269), in
 * place of a badge on every row, card, and chart (`everySimulated` decides). A labeled region, so a
 * screen reader user reaches it by landmark as well as in reading order, and the explanation is
 * visible text rather than the badge's hover title.
 */
export function SimulatedNotice() {
  return (
    <section
      aria-label="Simulated data"
      className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-panel px-5 py-3 text-sm"
    >
      <SimulatedBadge />
      <p className="leading-6 text-muted">
        Every connection in view is simulated, so what this page shows is example data made up on this computer, not read
        from a provider.
      </p>
    </section>
  );
}
